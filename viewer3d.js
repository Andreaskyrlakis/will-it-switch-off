// 3D view of one galaxy, snapshot by snapshot: a copy of the real gas cells and star particles,
// read from compact binary files (see src/game_assets.py): about 15,000 of each for the normal
// view, up to 150,000 of each ("cloud_full_*") for the full-screen view.
// Each particle is a soft round sprite whose size is its real size in the simulation (gas: cell
// radius; stars: smoothing scale). Sprites add up their light in a high-range buffer, which is then
// tone-mapped to the screen, so dense cores stay readable instead of burning out to white.
// Between two snapshots the two clouds fade into each other (no particle is moved or invented).

// Block map
//   0. SETTINGS     libraries, the binary record size, light, framing and opening-glide settings
//   3. RENDERING: the 3D galaxy
//      3a. particle colour and light   starColour, starWeight, gasWeight, gasColour
//      3b. shaders                     VERTEX, FRAGMENT (the sprites), METER (+ its settings), TONEMAP
//      3c. the viewer: renderer, scene, camera, draw loop, sizes
//                                      constructor, setFull, pixelRatio, pixelsPerUnit, resize, fitDistance
//      3d. the opening glide           pose, startIntro, stepIntro, endIntro
//      3e. light metering (exposure)   readMeter, wantedExposure, calibrate, measureLight, holdExposure, releaseExposure
//      3f. framing a galaxy            replay, measure
//      3g. loading the clouds (data)   get, load, evict, clear
//      3h. showing clouds              display
//      3i. reading a binary cloud      build (the DATA side: bytes -> particles -> GPU buffers)
//      3j. options from the page       recolour, set
//   Public API used by the page: new GalaxyViewer(container, bar), load, get, display, clear, replay,
//   setFull, set, holdExposure, releaseExposure.

// =====================================================================
// 0. SETTINGS
// =====================================================================
// The libraries, the layout of one particle in the binary files, and the
// numbers the look was tuned with: light, framing and the opening glide.

import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const RECORD = 10; // bytes: int16 x, y, z, uint8 kind, uint8 value, uint16 size (0.01 kpc)
const REFERENCE = 15000; // particles per kind the brightness below was tuned for
const GAS_RATIO_REF = 4;   // gas mass / stellar mass of a typical galaxy of the game (median of the pool)
// Light: the stars of every galaxy shine with the same total light (so every galaxy can be seen);
// its gas shines with the square root of its real gas mass compared with its stars at that snapshot,
// so a gas-poor galaxy looks gas-poor (but its gas can still be seen). Each particle carries an equal share of its kind's light.
const KEEP = 15;          // clouds kept ready on the graphics card: all 13 saved moments and two more (others are rebuilt when needed)
// Framing: the camera looks at the galaxy from 27° above its disc, from the distance at which 80 % of its stars
// fill FILL of the free part of the view (the part above the time bar), so small and large galaxies fill it alike.
const VIEW_DIR = new THREE.Vector3(0, 0.28, 0.55).normalize();   // the direction the camera looks from
const FILL = 0.8;
const EXPOSURE = 1.35;                    // the starting exposure, before the meter has measured anything
// The opening: the camera glides in from further out and higher above the disc while the light comes up.
const INTRO_MS = 2800, INTRO_FAR = 2.7, INTRO_HIGHER = 0.55, INTRO_TURN = -0.85;   // distance ×, radians, radians
// visitors who ask their system for less motion get no glide
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// =====================================================================
// 3. RENDERING: the 3D galaxy
// =====================================================================
// Every particle becomes a soft sprite on the graphics card (WebGL, via
// three.js). The sprites add up their light in a high-range picture, a meter
// measures how bright it is, and a last pass tone-maps it to the screen.

// ---- 3a. particle colour and light

function starColour(ageClass) {
  // young stars blue-white, old stars gold (age 0 to 12 Gyr)
  const t = Math.min(1, ageClass / 255 / 0.6);       // fully gold from 60 % of the age scale (about 7 Gyr)
  const young = [0.62, 0.75, 1.0], old = [1.0, 0.78, 0.5];   // red, green, blue between 0 and 1
  return young.map((v, i) => v + t * (old[i] - v));
}

/** A star particle's light by its real age, as a stellar population fades: about age^-0.6 (young stars shine
 *  several times more than old ones). A galaxy that stops making stars therefore dims as its stars age. */
const STAR_FADE = 0.6;
function starWeight(ageClass) {
  // I keep the age at 0.05 Gyr or more, so the newest stars do not get an endless light
  return Math.pow(Math.max((ageClass / 255) * 12, 0.05), -STAR_FADE);   // age class 0..255 = 0 to 12 Gyr
}

/** A gas cell's light: gas that is forming stars glows (up to 1 + GAS_GLOW times, by its real star-formation rate),
 *  so a galaxy that stops forming stars loses its glow and dims. */
const GAS_GLOW = 4;
function gasWeight(sfrClass) {
  return sfrClass > 0 ? 1 + GAS_GLOW * (0.4 + 0.6 * (sfrClass / 255)) : 1;
}

/** A gas cell's colour: plain purple, or (bySf, the "star formation" option) dark blue when it forms no
 *  stars and orange to red the more it forms. */
function gasColour(sfrClass, bySf) {
  if (!bySf) return [0.78, 0.42, 0.85];
  if (sfrClass === 0) return [0.25, 0.3, 0.55];   // not forming stars
  const t = sfrClass / 255;
  return [1.0, 0.75 - 0.25 * t, 0.45 - 0.3 * t];
}

// ---- 3b. shaders (small programs that run on the graphics card; the text inside the strings is GLSL)

// VERTEX runs once per particle: it places the sprite on screen and sets its size in pixels
const VERTEX = `
  attribute float size;
  attribute vec3 colour;
  attribute float light;
  uniform float pixelsPerUnit;
  uniform float sizeScale;
  uniform float pixelRatio;
  varying vec3 vColour;
  varying float vFade;
  varying float vLight;
  void main() {
    vLight = light;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = sizeScale * size * pixelsPerUnit / -mv.z;
    gl_PointSize = clamp(px, 1.6 * pixelRatio, 256.0);
    // a sprite spread over more pixels is fainter per pixel (a big, diffuse gas cell stays a faint haze)
    vFade = min(1.0, 36.0 * pixelRatio * pixelRatio / (gl_PointSize * gl_PointSize));
    vColour = colour;
    gl_Position = projectionMatrix * mv;
  }`;

// FRAGMENT runs once per pixel of each sprite: a soft round blob whose light is added to the picture
const FRAGMENT = `
  uniform float opacity;
  uniform float fade;
  uniform float weighted;   // 1: light by age and star formation; 0: every particle alike (to calibrate the meter)
  uniform float wMean;      // the mean weight of the galaxy's first cloud (opacity is divided by it)
  varying vec3 vColour;
  varying float vFade;
  varying float vLight;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d) * 4.0;          // 0 at the centre, 1 at the edge
    if (r2 > 1.0) discard;
    // the sprite's shape and its size fading keep the crisp look the view was tuned on; its light is linear in
    // opacity and fade (added as is, ONE + ONE), so a crossfade between two moments keeps the picture's light
    float shape = exp(-3.0 * r2) * (1.0 - r2 * r2) * vFade;
    float a = shape * shape * opacity * fade * mix(wMean, vLight, weighted);
    gl_FragColor = vec4(vColour * a, a);
  }`;

// the exposure meter: the brightness of a small copy of the picture, on a log scale (2^-20 to 2^4), read back
// a few times a second so that every galaxy, at any size of view and any zoom, shows its bright core alike
const METER = `
  uniform sampler2D hdr;
  varying vec2 vUv;
  void main() {
    float l = dot(texture2D(hdr, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(clamp((log2(max(l, 1e-7)) + 20.0) / 24.0, 0.0, 1.0), 0.0, 0.0, 1.0);
  }`;
const METER_N = 128, METER_MS = 300, CORE = 0.985, CORE_LEVEL = 1.9;   // the brightest 1.5 % of the view reaches 85 % white
// ... and a sparse galaxy (a bright core with lone points around it) is lifted until its typical lit point shows,
// at most 4 times brighter: its core then turns white, as a long exposure would show it
const BODY_LEVEL = 0.3, LIFT_MAX = 4;
// While the time bar plays, the exposure is held at its value at the start of playback, so a galaxy that fades
// looks dimmer (and turns golden as its stars age); the meter may still lower it, or raise it by at most LOCK_LIFT,
// so that a galaxy that switches off never turns nearly black. A zoom or a new size of view lets it adapt again.
const LOCK_LIFT = 1.15, LOCK_ZOOM = 0.12;
const EXPOSURE_RANGE = [0.2, 12];       // for a view of REF_AREA; a bigger view spreads the same light over more pixels
const REF_AREA = 760 * 560;            // CSS pixels: the laptop view the light was tuned on
// (METER_N: the meter's picture is 128 x 128; METER_MS: I read it every 300 ms; CORE: the brightest 1.5 % start
// at 98.5 % of the sorted pixels; LOCK_ZOOM: a zoom of more than 12 % releases the held exposure)

// tone mapping: light is compressed on its brightness only, so colours keep their hue; the very
// brightest parts fade towards white, as on a long-exposure photograph
const TONEMAP = `
  uniform sampler2D hdr;
  uniform float exposure;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(hdr, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float lt = 1.0 - exp(-exposure * l);
    vec3 col = c * (lt / max(l, 1e-5));
    col = mix(col, vec3(lt), smoothstep(0.75, 1.0, lt) * 0.55);
    gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.92)), 1.0);
  }`;

export class GalaxyViewer {
  // ---- 3c. the viewer: renderer, scene, camera, draw loop, sizes

  /** container: the element the view fills; bar: the time bar over its bottom (the galaxy is centred above it). */
  constructor(container, bar = null) {
    this.container = container;
    this.bar = bar;
    this.insets = { top: 0, bottom: 0 };
    this.extent = null;        // where the galaxy's stars are (set from its first cloud)
    this.intro = null;         // the opening glide, while it runs
    this.userMoved = false;    // once the visitor turns or zooms, the camera is theirs
    this.full = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.domElement.setAttribute("aria-label", "3D view of the galaxy: drag to turn, scroll or pinch to zoom");
    container.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    // a 45° field of view; the camera sees from 0.05 to 5000 kpc away
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
    // drag to turn and scroll to zoom around the galaxy; it also turns slowly on its own
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.06, rotateSpeed: 0.6, zoomSpeed: 0.7,
      autoRotate: true, autoRotateSpeed: 0.5, enablePan: false });
    this.controls.addEventListener("start", () => { this.userMoved = true; this.endIntro(); this.controls.autoRotate = false; });
    // high-range buffer the sprites add up into, and the pass that tone-maps it to the screen
    // (half-float pixels can hold light above 1; samples: 4 smooths the edges)
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    // the tone-map pass is one flat square that fills the screen, seen by a flat camera
    this.post = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.tonemap = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: TONEMAP,
      uniforms: { hdr: { value: this.target.texture }, exposure: { value: EXPOSURE } },
      depthTest: false, depthWrite: false,
    });
    this.post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.tonemap));
    // the exposure meter (see METER) and the exposure it sets, eased so it never jumps
    this.meter = new THREE.WebGLRenderTarget(METER_N, METER_N);
    this.meterScene = new THREE.Scene();
    this.meterScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: METER, uniforms: { hdr: { value: this.target.texture } }, depthTest: false, depthWrite: false,
    })));
    this.meterPixels = new Uint8Array(METER_N * METER_N * 4);   // red, green, blue, alpha per meter pixel
    this.meterLevels = new Float32Array(METER_N * METER_N);
    // the exposure: now (shown), target (wanted), next (when to read the meter), last (the last frame's time),
    // lock (the exposure held while playing), lockDist (the camera distance then), pendingAt (when to take the lock)
    this.exposure = { now: EXPOSURE, target: EXPOSURE, next: 0, last: 0, lock: null, lockDist: 0, pendingAt: 0 };
    this.size = { w: 0, h: 0 };
    this.introLight = 1;
    this.show = { stars: true, gas: true, bySf: false };   // the options the page can switch (see set)
    this.starLight = 0.36; this.gasLight = 36;             // the light of the earlier (squared) look, 0.6² and 6², now linear
    this.cache = new Map();                               // the clouds loaded or loading, by file url
    this.failed = new Set();                              // the urls that failed: I do not try them again
    this.shown = [];                                      // the clouds on screen now (one, or two during a crossfade)
    // I redraw at the right size when the box or the time bar changes size
    const watch = new ResizeObserver(() => this.resize());
    watch.observe(container);
    if (bar) watch.observe(bar);
    window.addEventListener("resize", () => this.resize());
    this.resize();
    // the draw loop, once per screen frame
    const loop = () => {
      const now = performance.now();
      if (this.intro) this.stepIntro(now);
      this.controls.update();
      // 1. the sprites add their light into the high-range picture
      this.renderer.setRenderTarget(this.target);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      if (this.exposure.lock && Math.abs(this.camera.position.distanceTo(this.controls.target) / this.exposure.lockDist - 1) > LOCK_ZOOM) {
        this.releaseExposure();                               // the visitor zoomed: the exposure adapts again
      }
      // 2. the meter, a few times a second
      if (this.calibratePending && this.shown.length && this.extent) this.calibrate();
      if (this.shown.length && now >= this.exposure.next) { this.exposure.next = now + METER_MS; this.measureLight(); }
      // 3. the exposure eases towards its target (dt: seconds since the last frame, at most 0.1)
      const dt = Math.min(0.1, (now - (this.exposure.last || now)) / 1000);
      this.exposure.last = now;
      this.exposure.now += (this.exposure.target - this.exposure.now) * Math.min(1, dt * 3);
      this.tonemap.uniforms.exposure.value = this.exposure.now * this.introLight;
      // 4. the tone-mapped picture goes to the screen (render target null = the screen)
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.post, this.postCamera);
      this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  /** Full screen: the screen's own resolution (capped at 2x, the sprites are soft anyway). */
  setFull(full) {
    this.full = full;
    this.resize();
  }

  /** How many screen pixels per CSS pixel: at most 1.5 in the normal view, 2 in full screen. */
  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.full ? 2 : 1.5);
  }

  /** How many pixels one kpc covers at distance 1 from the camera (the shader divides by the real distance). */
  pixelsPerUnit() {
    const h = this.renderer.domElement.height;
    return h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;                                   // hidden: nothing to size
    if (w !== this.size.w || h !== this.size.h) { this.size = { w, h }; this.releaseExposure(); }   // a new size of view
    const ratio = this.pixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.target.setSize(Math.round(w * ratio), Math.round(h * ratio));
    this.camera.aspect = w / h;
    // the time bar covers the bottom of the view: the picture is shifted up so the galaxy sits in the middle of the rest
    const top = this.bar ? this.bar.offsetTop : h;
    this.insets.bottom = top > 0 && top < h ? h - top : 0;
    const shift = Math.round((this.insets.bottom - this.insets.top) / 2);
    if (shift) this.camera.setViewOffset(w, h, 0, shift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    // every cloud already built gets the new pixel scale
    for (const e of this.cache.values()) {
      if (!e.frame) continue;
      for (const g of Object.values(e.frame.groups)) {
        g.material.uniforms.pixelsPerUnit.value = this.pixelsPerUnit();
        g.material.uniforms.pixelRatio.value = ratio;
      }
    }
    // a new size (full screen, a turned phone) frames the galaxy again, unless the visitor has moved the camera
    if (this.extent && !this.userMoved && !this.intro) {
      const d = this.camera.position.clone().sub(this.controls.target).setLength(this.fitDistance());   // same turn, new distance
      this.camera.position.copy(this.controls.target).add(d);
    }
  }

  /** The distance at which the galaxy's stars fill FILL of the free part of the view, across and up-down. */
  fitDistance() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return this.lastFit || 20;                 // hidden: keep the last framing
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);   // tan of half the field of view
    const free = Math.max(h * 0.4, h - this.insets.top - this.insets.bottom);   // the free height, at least 40 % of the view
    // half the view's height and width at distance 1
    const halfUp = tanV * (free / h), halfAcross = tanV * (w / h);
    const tilt = Math.asin(VIEW_DIR.y);                     // the view is 27° above the disc
    const { r, z } = this.extent;
    // the galaxy's size seen from the tilted view: across, and up-down (the tilted disc plus its thickness)
    const across = r, upDown = r * Math.sin(tilt) + z * Math.cos(tilt);
    // far enough back that both fit: the larger of the two distances
    this.lastFit = Math.max(across / (FILL * halfAcross), upDown / (FILL * halfUp));
    return this.lastFit;
  }

  // ---- 3d. the opening glide

  /** The camera on the opening glide: u = 0 far out and high above the disc, u = 1 the resting view. */
  pose(u) {
    const k = 1 - (1 - u) ** 3;                             // ease out: fast at first, settling softly
    // the resting direction as angles (phi from the top, theta around); the glide starts higher and turned
    const rest = new THREE.Spherical().setFromVector3(VIEW_DIR);
    const dist = this.fitDistance() * (INTRO_FAR + (1 - INTRO_FAR) * k);
    const phi = rest.phi - INTRO_HIGHER * (1 - k), theta = rest.theta + INTRO_TURN * (1 - k);
    return new THREE.Vector3().setFromSphericalCoords(dist, phi, theta).add(this.controls.target);
  }

  startIntro() {
    this.releaseExposure();
    this.controls.target.set(0, 0, 0);                      // the camera looks at the galaxy's centre
    if (REDUCED) { this.camera.position.copy(this.pose(1)); this.endIntro(); return; }   // less motion: straight to the rest
    this.intro = { t0: performance.now() };
    this.controls.autoRotate = false;
    this.stepIntro(this.intro.t0);
  }

  stepIntro(now) {
    const u = Math.min(1, (now - this.intro.t0) / INTRO_MS);
    this.camera.position.copy(this.pose(u));
    const light = Math.min(1, u / 0.4);                     // the light comes up in the first part of the glide
    this.introLight = 1 - (1 - light) ** 2;
    if (u >= 1) this.endIntro();
  }

  endIntro() {
    this.intro = null;
    this.introLight = 1;
    this.controls.autoRotate = !this.userMoved;             // then the slow turn, until the visitor takes over
    this.calibratePending = true;                           // the resting view: calibrate the meter on it
  }

  // ---- 3e. light metering (the automatic exposure)

  /** The picture just rendered, read through the exposure meter: its core (mean of the brightest 1.5 %), its typical
   *  lit point and the share of the view that is lit. */
  readMeter() {
    this.renderer.setRenderTarget(this.meter);
    this.renderer.render(this.meterScene, this.postCamera);
    // I copy the meter's pixels from the graphics card back to JavaScript
    this.renderer.readRenderTargetPixels(this.meter, 0, 0, METER_N, METER_N, this.meterPixels);
    this.renderer.setRenderTarget(this.target);
    const levels = this.meterLevels;
    // undo the METER shader's log scale: the red byte 0..255 back to a brightness from 2^-20 to 2^4
    for (let i = 0; i < levels.length; i++) levels[i] = 2 ** ((this.meterPixels[4 * i] / 255) * 24 - 20);
    levels.sort();                                          // darkest first
    let sum = 0;
    const from = Math.floor(levels.length * CORE);
    for (let i = from; i < levels.length; i++) sum += levels[i];   // the brightest 1.5 %
    const firstLit = levels.findIndex((l) => l > 1e-4);     // the first pixel that is not black
    // lit: the brightness 90 % of the way up the lit pixels
    return { core: sum / (levels.length - from), lit: firstLit < 0 ? 0 : levels[firstLit + Math.floor((levels.length - firstLit) * 0.9)],
      litShare: firstLit < 0 ? 0 : 1 - firstLit / levels.length };
  }

  /** The exposure a reading asks for: its core to 85 % white, or for a sparse view up to 4 times more. */
  wantedExposure({ core, lit, litShare }) {
    if (core <= 1e-5) return null;                          // a black picture: nothing to measure
    // sparse: much of the view is still black (a dense galaxy lights 85 % or more of it, a sparse one about 55 %)
    const sparse = Math.min(1, Math.max(0, (0.8 - litShare) / 0.2));
    // the exposure that brings the core to its level, and the one that brings the typical lit point to its level
    const fromCore = CORE_LEVEL / core, fromBody = lit > 1e-5 ? BODY_LEVEL / lit : fromCore;
    // at least fromCore; lifted towards fromBody, but never past LIFT_MAX times fromCore (and only when sparse)
    return Math.max(fromCore, Math.min(fromBody, (1 + (LIFT_MAX - 1) * sparse) * fromCore));
  }

  /** The light by age and star formation makes young and star-forming points brighter and leaves less of the same
   *  light to old stars and diffuse gas; the meter would then darken the whole picture. So, once per galaxy (on its
   *  first picture, then on its resting view), the picture is also measured with every particle alike, and the
   *  meter is corrected so that the typical lit point (old stars, diffuse gas) is as bright as it was before the
   *  light followed the particles: the first view keeps its look, active regions glow, later moments that really
   *  dim look dimmer. */
  calibrate() {
    const materials = this.shown.flatMap((f) => Object.values(f.groups)).map((g) => g.material);
    // draw the picture once with the given setting, read the meter, and say what exposure it would want
    const draw = (weighted) => {
      materials.forEach((m) => { m.uniforms.weighted.value = weighted; });
      this.renderer.setRenderTarget(this.target);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      const reading = this.readMeter();
      return { reading, wanted: this.wantedExposure(reading) };
    };
    const alike = draw(0), weighted = draw(1);              // every particle alike, then the real light (weighted stays 1)
    if (alike.wanted && weighted.wanted && this.extent) {
      // how much dimmer the typical lit point became with the real light
      const body = alike.reading.lit > 1e-5 && weighted.reading.lit > 1e-5 ? alike.reading.lit / weighted.reading.lit : 1;
      // the correction, kept between 0.5 and 4
      this.extent.calib = Math.min(4, Math.max(0.5, (alike.wanted * body) / weighted.wanted));
    }
    this.calibratePending = false;
  }

  /** Read the exposure meter and set the exposure (see wantedExposure, calibrate, holdExposure). */
  measureLight() {
    const reading = this.readMeter();
    this.lastCore = reading.core; this.lastLit = reading.lit; this.lastLitShare = reading.litShare;   // (read by the page's tests)
    // a view bigger than the tuning view may take a larger exposure (gain), never a smaller one
    const gain = Math.max(1, (this.container.clientWidth * this.container.clientHeight) / REF_AREA);
    const wanted = this.wantedExposure(reading);
    if (wanted) {
      const calibrated = wanted * ((this.extent && this.extent.calib) || 1);
      // kept inside EXPOSURE_RANGE (scaled by gain)
      let target = Math.min(EXPOSURE_RANGE[1] * gain, Math.max(EXPOSURE_RANGE[0] * gain, calibrated));
      const ex = this.exposure;
      if (ex.pendingAt && performance.now() >= ex.pendingAt) {   // the start of playback: this picture sets the held exposure
        ex.pendingAt = 0;
        ex.lock = target;
        ex.lockDist = this.camera.position.distanceTo(this.controls.target);
      }
      if (ex.lock) target = Math.min(target, ex.lock * LOCK_LIFT);   // while held: at most 15 % above the held value
      ex.target = target;
    }
  }

  /** Hold the exposure while the time bar plays (see LOCK_LIFT). fresh: measure it again on the picture about to be
   *  shown (playing again from the start), else keep the one already held. */
  holdExposure(fresh = false) {
    if (this.exposure.lock && !fresh) return;
    this.exposure.lock = null;
    this.exposure.pendingAt = performance.now() + 150;     // once the start of playback is on screen
    this.exposure.next = 0;                                 // read the meter on the next frame
  }

  /** Let the exposure adapt freely again (no held value, none waiting). */
  releaseExposure() {
    this.exposure.lock = null;
    this.exposure.pendingAt = 0;
  }

  // ---- 3f. framing a galaxy

  /** The same galaxy shown again: frame it and glide in again. */
  replay() {
    if (!this.extent) return;
    this.userMoved = false;
    this.startIntro();
  }

  /** Where the galaxy's stars are (80 % of them lie within r of the spin axis and within z of the disc plane),
   *  and how its gas is drawn in that frame. Gas drawn from few, large cells (small galaxies) would cover its
   *  stars with big blobs: its sprites are made smaller (never larger than real). And where the gas inside the
   *  frame would outshine the stars there, it is made fainter, down to a balance that still follows its real
   *  gas: a gas-rich galaxy keeps more gas light than its stars, a gas-poor one less. */
  measure(p, gas, gasShare = 1, stars = null) {
    // each particle's distance from the spin axis (r) and from the disc plane (z)
    const r = new Float32Array(p.k), z = new Float32Array(p.k);
    for (let k = 0; k < p.k; k++) {
      r[k] = Math.hypot(p.pos[3 * k], p.pos[3 * k + 2]);     // three.js: y is the spin axis
      z[k] = Math.abs(p.pos[3 * k + 1]);
    }
    r.sort(); z.sort();
    // the value a share q of the way up a sorted list (q = 0.8: 80 % of the particles are below it)
    const at = (a, q) => (a.length ? a[Math.floor(a.length * q)] : 0);
    // at least 1.5 kpc across and 0.3 kpc thick, so a tiny galaxy is not zoomed in too far
    const extent = { r: Math.max(1.5, at(r, 0.8)), z: Math.max(0.3, at(z, 0.8)), gasSize: 1, gasLight: 1, starW: 1, gasW: 1 };
    // the mean light weight of a kind's particles
    const mean = (q) => { let w = 0; for (let k = 0; k < q.k; k++) w += q.light[k]; return q.k ? w / q.k : 1; };
    if (stars && stars.k) extent.starW = mean(stars);         // the mean light by age of the first cloud's stars
    if (gas.k) extent.gasW = mean(gas);                       // ... and by star formation of its gas
    if (gas.k && p !== gas) {                                 // only when the frame came from the stars
      const sizes = gas.size.slice(0, gas.k).sort();
      const share = (q) => {                                // share of a kind's particles inside the frame
        let n = 0;
        for (let k = 0; k < q.k; k++) n += Math.hypot(q.pos[3 * k], q.pos[3 * k + 1], q.pos[3 * k + 2]) < 1.4 * extent.r ? 1 : 0;
        return Math.max(0.01, n / q.k);
      };
      // the gas sprites shrink when the median cell is big next to the galaxy (between 0.4 and 1 times their size)
      extent.gasSize = Math.max(0.4, Math.min(1, (0.1 * extent.r) / (2 * Math.max(0.05, at(sizes, 0.5)))));
      // the balance of gas and star light in the frame that the view was tuned on (when the light of each kind
      // went as the square of its share), kept for this galaxy: the earlier rule, then the same balance now
      // that light is linear (each kind's light no longer depends on how many particles it has)
      const shareRatio = share(gas) / share(p);
      const earlier = Math.min(1, Math.min(1.6, Math.max(0.4, 1.2 * gasShare)) / (10 * gasShare * shareRatio));
      extent.gasLight = Math.min(4, gasShare * earlier * earlier * (p.k / gas.k));
    }
    return extent;
  }

  // ---- 3g. loading the clouds (the data: download, keep, forget)

  /** A cloud ready to show, or null while it loads (the load starts on the first ask). */
  get(url, scaleKpc, masses) {
    const entry = this.cache.get(url);
    // ready: I note when it was last used (the least used are forgotten first)
    if (entry && entry.frame) { entry.used = performance.now(); return entry.frame; }
    if (!entry && !this.failed.has(url)) {
      // not asked for yet: I start the download and keep a placeholder in the cache
      const record = { frame: null, used: performance.now(), error: null };
      this.cache.set(url, record);
      record.promise = fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`could not load ${url}`); return r.arrayBuffer(); })
        .then((buffer) => { record.frame = this.build(new DataView(buffer), scaleKpc, masses); this.evict(); return record.frame; })
        .catch((error) => { record.error = error; this.cache.delete(url); this.failed.add(url); throw error; });
      record.promise.catch(() => {});                       // no "unhandled error" warning when nobody waits for it
    }
    return null;
  }

  /** Wait for a cloud (used for the first one, so that errors can be reported). */
  async load(url, scaleKpc, masses) {
    const ready = this.get(url, scaleKpc, masses);
    if (ready) return ready;
    return this.cache.get(url).promise;
  }

  /** Keep at most KEEP clouds on the graphics card: forget the ones used longest ago. */
  evict() {
    // the loaded clouds, least recently used first
    const loaded = [...this.cache.entries()].filter(([, e]) => e.frame).sort((x, y) => x[1].used - y[1].used);
    while (loaded.length > KEEP) {
      const [url, e] = loaded.shift();
      if (this.shown.includes(e.frame)) continue;           // never the one on screen
      // dispose frees the graphics card's memory
      for (const g of Object.values(e.frame.groups)) { this.scene.remove(g); g.geometry.dispose(); g.material.dispose(); }
      this.cache.delete(url);
    }
  }

  /** Forget every cloud (a new galaxy). */
  clear() {
    for (const e of this.cache.values()) {
      if (!e.frame) continue;
      for (const g of Object.values(e.frame.groups)) { this.scene.remove(g); g.geometry.dispose(); g.material.dispose(); }
    }
    this.cache.clear();
    this.failed.clear();
    this.shown = [];
    this.placed = false;
    this.extent = null;
    this.intro = null;
    this.userMoved = false;
    this.calibratePending = false;
    this.introLight = 1;
    Object.assign(this.exposure, { now: EXPOSURE, target: EXPOSURE, next: 0, lock: null, pendingAt: 0 });
  }

  // ---- 3h. showing clouds

  /** Show cloud a, cloud b, or a crossfade between them (w = 0: only a; w = 1: only b). */
  display(a, b, w) {
    // each cloud with its fade; I drop a missing cloud and one that would be invisible
    const want = [[a, b ? 1 - w : 1], [b, w]].filter(([f, fade]) => f && fade > 0.001);
    // clouds on screen that are not wanted any more leave the scene
    for (const f of this.shown) {
      if (!want.some(([g]) => g === f)) for (const p of Object.values(f.groups)) this.scene.remove(p);
    }
    for (const [f, fade] of want) {
      this.recolour(f);                                     // in case the gas colour option changed since it was built
      for (const [name, p] of Object.entries(f.groups)) {
        p.material.uniforms.fade.value = fade;
        p.visible = this.show[name];
        if (p.parent !== this.scene) this.scene.add(p);
      }
    }
    this.shown = want.map(([f]) => f);
  }

  // ---- 3i. reading a binary cloud (the data side: bytes -> particles -> buffers on the graphics card)

  /** Turn one downloaded file (a DataView over its bytes) into a cloud: one group of points for gas, one for stars. */
  build(view, scaleKpc, masses) {
    const n = view.byteLength / RECORD;                    // the number of particles: 10 bytes each
    // a first pass counts the stars (byte 6 is the kind: 1 = star, 0 = gas), to size the arrays
    let nStars = 0;
    for (let i = 0; i < n; i++) nStars += view.getUint8(i * RECORD + 6) === 1 ? 1 : 0;
    // empty arrays for one kind: positions and colours (3 numbers each), size, light, the raw value byte;
    // k counts the particles filled in so far
    const make = (count) => ({ pos: new Float32Array(count * 3), col: new Float32Array(count * 3), size: new Float32Array(count),
      light: new Float32Array(count), raw: new Uint8Array(count), k: 0 });
    const parts = { gas: make(n - nStars), stars: make(nStars) };
    for (let i = 0; i < n; i++) {
      const o = i * RECORD;                                 // where this particle's 10 bytes start
      // positions are stored as whole numbers from -32767 to 32767, standing for -scaleKpc to +scaleKpc
      // (true: the bytes are little-endian)
      const x = (view.getInt16(o, true) / 32767) * scaleKpc;
      const y = (view.getInt16(o + 2, true) / 32767) * scaleKpc;
      const z = (view.getInt16(o + 4, true) / 32767) * scaleKpc;
      // value: a star's age class, or a gas cell's star-formation class (0 to 255)
      const kind = view.getUint8(o + 6), value = view.getUint8(o + 7);
      const p = kind === 1 ? parts.stars : parts.gas, k = p.k++;   // k: this particle's place in its kind's arrays
      // disc frame: z is the spin axis; three.js uses y up
      p.pos[3 * k] = x; p.pos[3 * k + 1] = z; p.pos[3 * k + 2] = -y;
      p.size[k] = view.getUint16(o + 8, true) / 100;               // kpc
      p.raw[k] = value;
      p.light[k] = kind === 1 ? starWeight(value) : gasWeight(value);
      p.col.set(kind === 1 ? starColour(value) : gasColour(value, this.show.bySf), 3 * k);
    }
    // I keep the gas's raw values, to recolour it later without reading the file again
    const frame = { groups: {}, gasRaw: parts.gas.raw, counts: { gas: parts.gas.k, stars: parts.stars.k }, bySf: this.show.bySf };
    const gasShare = masses && masses.mstar > 0
      ? Math.min(2.5, Math.max(0.12, Math.sqrt(masses.mgas / masses.mstar / GAS_RATIO_REF))) : 1;   // square root: gas-poor stays thinner, never invisible
    if (!this.placed) {
      // the first cloud of a galaxy: frame it from where its stars are (its gas when it has almost no stars), and
      // set its gas for the frame; then glide in
      this.extent = this.measure(parts.stars.k >= 50 ? parts.stars : parts.gas, parts.gas, gasShare, parts.stars);
      this.controls.minDistance = this.extent.r * 0.6;
      this.controls.maxDistance = scaleKpc * 4;
      this.placed = true;
      this.extent.calib = 1;
      this.startIntro();
      this.calibratePending = true;                         // on its first picture (then again on the resting view)
    }
    const look = this.extent || { gasSize: 1, gasLight: 1 };
    for (const [name, p] of Object.entries(parts)) {
      if (!p.k) continue;                                   // a kind with no particles gets no group
      // the arrays become buffers on the graphics card, one per attribute the VERTEX shader reads
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(p.pos, 3));
      geometry.setAttribute("colour", new THREE.BufferAttribute(p.col, 3));
      geometry.setAttribute("size", new THREE.BufferAttribute(p.size, 1));
      geometry.setAttribute("light", new THREE.BufferAttribute(p.light, 1));
      // the kind's total light is shared out over its particles (a denser copy: lighter particles)
      const perParticle = REFERENCE / p.k;
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, depthTest: false,
        // plain addition of light: not THREE.AdditiveBlending, which multiplies by alpha once more (light would go as
        // the square of each particle's share, and a crossfade between two moments would dim the picture by half)
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
        uniforms: {
          pixelsPerUnit: { value: this.pixelsPerUnit() },
          pixelRatio: { value: this.pixelRatio() },
          sizeScale: { value: name === "stars" ? 0.8 : 2.0 * look.gasSize },   // the sprite size per kind, as tuned by eye
          // light by star age and by gas star formation, divided by their mean in the galaxy's first cloud, so that
          // the first view keeps its balance and a later moment with older stars and less star-forming gas is dimmer
          opacity: { value: (name === "stars" ? this.starLight / (look.starW || 1)
            : (this.gasLight * gasShare * look.gasLight) / (look.gasW || 1)) * perParticle },
          fade: { value: 0 },
          weighted: { value: 1 },
          wMean: { value: name === "stars" ? look.starW || 1 : look.gasW || 1 },
        },
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      frame.groups[name] = points;
    }
    return frame;
  }

  // ---- 3j. options from the page

  /** Give a cloud's gas the colours of the current option (plain purple or by star formation). */
  recolour(frame) {
    if (!frame.groups.gas || frame.bySf === this.show.bySf) return;   // no gas, or already right
    const colours = frame.groups.gas.geometry.getAttribute("colour");
    frame.gasRaw.forEach((v, i) => colours.setXYZ(i, ...gasColour(v, this.show.bySf)));
    colours.needsUpdate = true;                             // send the new colours to the graphics card
    frame.bySf = this.show.bySf;
  }

  /** Switch an option: "stars" or "gas" (shown or hidden), or "bySf" (gas coloured by star formation). */
  set(option, on) {
    this.show[option] = on;
    for (const f of this.shown) {
      if (option === "bySf") this.recolour(f);
      else if (f.groups[option]) f.groups[option].visible = on;
    }
  }
}
