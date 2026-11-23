// The sky of the game: the 12,710 training galaxies of data/map.json, each drawn as a point of light
// at its real place (stellar mass to the right, gas per star upwards). Nothing else is drawn in the
// sky: every point is a real galaxy. Three looks: a plain sky, a sky narrowed to the galaxies that fit
// the player's answers, and a sky coloured by the model's chance (with rings on the real switch-offs).
// Each point glows softly (a halo whose light adds up where galaxies crowd), bigger galaxies a little
// brighter; the points twinkle slowly in three groups out of step, and the whole sky drifts a few pixels.

// Block map
//   0. SETTINGS     the sky's data window, its colours, fade and twinkle timings
//   3. RENDERING: the sky of points
//      3a. halos and colours           halo (cached sprites), chanceColour, hash
//      3b. the Sky: reading the data   constructor (map.json columns in, the draw loop started)
//      3c. where things go on screen   field, setField, place, resize
//      3d. what the page asks for      set, setPlayer, setMarks, markAt, toScreen, playerScreen
//      3e. painting a look             paint (every galaxy into off-screen layers)
//      3f. the draw loop               drawLayers, placeNames, frame (twinkle, drift, fade, marks, the player's galaxy)
// (The data itself is loaded by game.js; this file only draws it.)

// =====================================================================
// 0. SETTINGS
// =====================================================================
// The window of the data the sky shows (stellar mass across, gas per star
// upwards, both in log10), the colours of the points, and the timings of the
// fade between looks and of the twinkle.

// the data window: x = log10 stellar mass, y = log10 gas per star
const DOMAIN = { x0: 8.9, x1: 12.25, y0: -1.6, y1: 1.7 };
// colours as [red, green, blue]
const STAR = [238, 241, 255], BLUE = [91, 143, 214], RED = [224, 69, 90], GREY = [70, 76, 104];
const FADE_MS = 900;                      // how long one look takes to fade into the next
const GROUPS = 3;                         // twinkle groups (one off-screen layer each)
const TWINKLE = [[5200, 0.0], [6900, 2.1], [8300, 4.2]];   // period (ms) and phase of each group
const MAX_LAYER_PIXELS = 4e6;             // keep the layers light on big screens

// =====================================================================
// 3. RENDERING: the sky of points
// =====================================================================
// Every galaxy of the training set becomes a soft point of light. I paint
// each look once into off-screen layers, then on every frame I only copy
// those layers to the screen with a gentle twinkle, so the sky stays smooth.

// ---- 3a. halos and colours

const sprites = new Map();                // the halos already drawn, by colour
/** A soft round halo of one colour, drawn once and reused. */
function halo(rgb) {
  // I round each colour channel down to steps of 8 (>> 3), so close colours share one halo
  const key = rgb.map((v) => v >> 3).join(",");
  if (sprites.has(key)) return sprites.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  // a radial gradient: full colour in the centre, fading out to nothing at the edge
  const g = c.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
  grad.addColorStop(0.25, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);
  grad.addColorStop(0.6, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.08)`);
  grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

/** The model's chance as a colour: grey, then steel blue, then crimson (square-root scale up to 60 %). */
export function chanceColour(chance) {
  // I square-root the chance so small chances still show colour
  const t = Math.min(1, Math.sqrt(chance / 0.6));
  // the first 15 % of the scale goes grey -> blue, the rest blue -> red
  const [a, b, u] = t < 0.15 ? [GREY, BLUE, t / 0.15] : [BLUE, RED, (t - 0.15) / 0.85];
  return a.map((v, i) => Math.round(v + u * (b[i] - v)));
}

/** A fixed pseudo-random number in [0, 1) per galaxy id, so each point keeps its own brightness. */
function hash(id, salt) {
  // a classic shader trick: the sine of a big number, keeping only the part after the decimal point
  const s = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export class Sky {
  // ---- 3b. the Sky: reading the data in

  /** data: map.json, in the {fields, points} form. */
  constructor(canvas, data) {
    this.canvas = canvas;
    // map.json stores a list of field names and one row per galaxy: I find each field's column number
    const f = Object.fromEntries(data.fields.map((name, i) => [name, i]));
    // one whole column as an array (null when the file does not have that field)
    const col = (name) => (f[name] === undefined ? null : data.points.map((p) => p[f[name]]));
    this.x = col("x"); this.y = col("y"); this.chance = col("chance"); this.quenched = col("quenched");
    this.central = col("is_central"); this.wind = col("wind"); this.id = col("id"); this.box = col("box");
    this.n = this.x.length;
    this.bright = this.id.map((id) => hash(id, 1));           // each galaxy's own fixed brightness
    this.group = this.id.map((id) => Math.floor(hash(id, 2) * GROUPS));   // and its twinkle group (0, 1 or 2)
    this.massT = this.x.map((v) => Math.min(1, Math.max(0, (v - 9.0) / 3.1)));   // 0 small ... 1 the biggest
    this.mode = { kind: "plain" };
    this.player = null;
    // visitors who ask their system for less motion get a still sky
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.layers = { prev: null, cur: null, t0: 0 };      // the look fading out, the look shown, when the fade began
    this.resize();
    window.addEventListener("resize", () => this.resize());
    // the next frame is asked for first, so one failed frame can never stop the sky for good
    const loop = (t) => { requestAnimationFrame(loop); this.frame(t); };
    requestAnimationFrame(loop);
  }

  // ---- 3c. where things go on screen

  /** The part of the screen the sky fills: the right side on a wide screen; on a narrow screen the
   *  page tells the sky how much room there is above the text (setField). */
  field(w, h) {
    if (this.override) return this.override;
    // by default: from 40 % to 96.5 % of the width, from 12 % to 90 % of the height
    return { l: w * 0.40, r: w * 0.965, t: h * 0.12, b: h * 0.90 };
  }

  /** Give the sky a rectangle (CSS px), or null for the default; redrawn only when it really moves. */
  setField(rect) {
    const old = this.override;
    // two rectangles count as the same when every side moved by less than 6 px (both null also counts)
    const same = (a, b) => (!a && !b) || (a && b && ["l", "r", "t", "b"].every((k) => Math.abs(a[k] - b[k]) < 6));
    if (same(old, rect)) return;
    this.override = rect;
    this.place();
    // the old picture fades into the new one
    this.layers = { prev: this.layers.cur, cur: this.paint(this.mode), t0: performance.now() };
  }

  /** Screen position of every galaxy, and the axis labels' place (CSS variables). */
  place() {
    const fl = this.field(this.w, this.h);
    // data values -> pixels; y is flipped because the screen's y grows downwards
    this.px = this.x.map((v) => fl.l + ((v - DOMAIN.x0) / (DOMAIN.x1 - DOMAIN.x0)) * (fl.r - fl.l));
    this.py = this.y.map((v) => fl.b - ((v - DOMAIN.y0) / (DOMAIN.y1 - DOMAIN.y0)) * (fl.b - fl.t));
    // I hand the sky's edges to the CSS (--fl, --fr, --ft, --fb), so the axis labels follow it
    const css = document.documentElement.style;
    for (const k of ["l", "r", "t", "b"]) css.setProperty(`--f${k}`, `${Math.round(fl[k])}px`);
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);   // sharp on high-density screens, but at most 2x
    const w = window.innerWidth, h = window.innerHeight;
    this.w = w; this.h = h; this.ratio = ratio;
    this.canvas.width = Math.round(w * ratio);
    this.canvas.height = Math.round(h * ratio);
    this.place();
    // the off-screen layers use a lower resolution on very big screens
    this.layerRatio = Math.min(ratio, Math.sqrt(MAX_LAYER_PIXELS / (w * h)));
    this.layers = { prev: null, cur: this.paint(this.mode), t0: 0 };   // no fade after a resize
  }

  // ---- 3d. what the page asks for

  /** Change the look; the old look fades into the new one. */
  set(mode) {
    this.mode = mode;
    this.layers = { prev: this.layers.cur, cur: this.paint(mode), t0: performance.now() };
  }

  setPlayer(xy) { this.player = xy; }

  /** Named galaxies to point at (the three remarkable ones): [{x, y, label}], one of them active. */
  setMarks(marks, active = -1, from = null) { this.marks = marks || []; this.activeMark = active; this.markFrom = from; }

  /** The named galaxy (a remarkable one, not a dot you met) under a screen point, or -1. */
  markAt(x, y) {
    let best = -1, bestD = 18;                           // only within 18 px of the pointer
    (this.marks || []).forEach((m, k) => {
      if (m.kind) return;                                // a dot you met has a kind ("on"/"off"): I skip it
      const p = this.toScreen(m), d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { best = k; bestD = d; }
    });
    return best;
  }

  /** Screen position (CSS pixels) of a point {x, y} given in data values. */
  toScreen(xy) {
    const fl = this.field(this.w, this.h);
    return {
      x: fl.l + ((xy.x - DOMAIN.x0) / (DOMAIN.x1 - DOMAIN.x0)) * (fl.r - fl.l),
      y: fl.b - ((xy.y - DOMAIN.y0) / (DOMAIN.y1 - DOMAIN.y0)) * (fl.b - fl.t),
    };
  }

  /** Screen position (CSS pixels) of the player's galaxy. */
  playerScreen() {
    if (!this.player) return { x: this.w / 2, y: this.h / 2 };   // no galaxy yet: the middle of the screen
    const fl = this.field(this.w, this.h);
    return {
      x: fl.l + ((this.player.x - DOMAIN.x0) / (DOMAIN.x1 - DOMAIN.x0)) * (fl.r - fl.l),
      y: fl.b - ((this.player.y - DOMAIN.y0) / (DOMAIN.y1 - DOMAIN.y0)) * (fl.b - fl.t),
    };
  }

  // ---- 3e. painting a look

  /** Draw one look into off-screen canvases, one per twinkle group. */
  paint(mode) {
    const W = Math.round(this.w * this.layerRatio), H = Math.round(this.h * this.layerRatio);
    if (!W || !H) return null;                          // a window with no size yet (a hidden tab or frame): nothing to draw
    // one blank canvas per twinkle group
    const layers = Array.from({ length: GROUPS }, () => {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      ctx.setTransform(this.layerRatio, 0, 0, this.layerRatio, 0, 0);
      ctx.globalCompositeOperation = "lighter";        // light adds up where galaxies crowd
      return { c, ctx };
    });
    const small = this.w < 600;                         // a phone: smaller points
    // the same 12,710 galaxies on a smaller sky crowd more: their halos are made fainter and smaller
    // (crowd is 1 on a sky of 460,000 square pixels or more, less on a smaller one)
    const fl = this.field(this.w, this.h), crowd = Math.min(1, ((fl.r - fl.l) * (fl.b - fl.t)) / 460000);
    const haloAlpha = crowd ** 0.75, haloSize = 0.6 + 0.4 * crowd;
    for (let i = 0; i < this.n; i++) {
      // for each galaxy: its colour (rgb), opacity (a), radius (r) and how much halo it gets (glow)
      let rgb = STAR, a, r, glow;
      const b = this.bright[i], m = this.massT[i];
      if (mode.kind === "chance") {
        // the model's look: coloured by the model's chance
        rgb = chanceColour(this.chance[i]); a = 0.88; r = small ? 1.1 : 1.45; glow = 0.55;
      } else if (mode.kind === "narrow" && !mode.lit[i]) {
        // the narrowed look, a galaxy that does not fit the answers: almost invisible, no halo
        a = 0.07; r = small ? 0.7 : 0.9; glow = 0;
      } else if (mode.kind === "narrow") {
        // the narrowed look, a galaxy that fits: bright
        a = 0.62 + 0.38 * b; r = (small ? 0.9 : 1.15) + 0.5 * b; glow = 0.7;
      } else {
        // the plain look (dimmed when the page asks for it)
        a = (0.28 + 0.5 * b * b) * (mode.dim ? 0.38 : 1); r = (small ? 0.7 : 0.85) + 0.55 * b; glow = mode.dim ? 0.25 : 0.6;
      }
      r *= 0.8 + 0.7 * m;                               // bigger galaxies: a bigger, brighter point
      const { ctx } = layers[this.group[i]];            // I draw it into its twinkle group's layer
      if (glow > 0) {
        const hs = r * (7 + 6 * m) * haloSize;          // half the halo's width
        ctx.globalAlpha = Math.min(1, a * glow * (0.35 + 0.75 * m) * 0.5 * haloAlpha);
        ctx.drawImage(halo(rgb), this.px[i] - hs, this.py[i] - hs, 2 * hs, 2 * hs);
      }
      // then the sharp point itself, on top of its halo
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
      ctx.beginPath(); ctx.arc(this.px[i], this.py[i], r, 0, 2 * Math.PI); ctx.fill();
    }
    if (mode.kind === "chance" && mode.rings) {
      // rings around the galaxies that really switched off, all in the first layer
      const ctx = layers[0].ctx;
      ctx.globalCompositeOperation = "source-over";     // normal drawing: the rings should not add up
      ctx.strokeStyle = "rgba(238,241,255,0.8)";
      ctx.lineWidth = 1;
      for (let i = 0; i < this.n; i++) {
        if (!this.quenched[i]) continue;
        ctx.beginPath(); ctx.arc(this.px[i], this.py[i], small ? 2.6 : 3.4, 0, 2 * Math.PI); ctx.stroke();
      }
    }
    return layers.map((l) => l.c);                      // I keep only the canvases
  }

  // ---- 3f. the draw loop

  /** Draw a look's layers, each twinkle group with its own slowly changing light. */
  drawLayers(ctx, layers, alpha, t, dx, dy) {
    layers.forEach((layer, k) => {
      if (!layer.width || !layer.height) return;        // an empty canvas cannot be drawn
      const [period, phase] = TWINKLE[k % TWINKLE.length];
      // the light of the group goes slowly between 68 % and 100 %, as a sine wave
      const tw = this.reduced ? 1 : 0.84 + 0.16 * Math.sin((2 * Math.PI * t) / period + phase);
      ctx.globalAlpha = alpha * tw;
      // the layer is stretched to the full canvas (it may have a lower resolution)
      ctx.drawImage(layer, dx, dy, this.canvas.width, this.canvas.height);
    });
  }

  /** Where each remarkable galaxy's name is written, as a Map: mark -> {x, y, align}. Its usual place is
   *  on the right of its ring (on the left near the screen's right edge). On a small map (a phone) two
   *  names can cross, cover the other ring or run off the screen: then I try the other places (the
   *  other side, above, below) and keep the layout that moves the names the least. On a computer the
   *  usual places are already free, so nothing moves. ctx must already have the names' font. */
  placeNames(ctx) {
    const named = (this.marks || []).filter((m) => !m.kind);   // the dots you met have no name here
    const fl = this.field(this.w, this.h);
    // half a name's height (13 px letters and their dark edge), how far a ring reaches, the margin to the screen's edge
    const H = 9, RING = 12, EDGE = 10;
    // the four places of each name, the usual one first; the usual place is free, the other side costs 1,
    // above or below the ring 2
    const choices = named.map((m) => {
      const p = this.toScreen(m), wd = ctx.measureText(m.label).width, usualLeft = p.x > this.w * 0.8;
      const side = (x, align, price) => ({ x, y: p.y, align, l: align === "left" ? x : x - wd, r: align === "left" ? x + wd : x, price });
      const right = side(p.x + 18, "left", usualLeft ? 1 : 0), left = side(p.x - 18, "right", usualLeft ? 0 : 1);
      const level = (y) => ({ x: p.x, y, align: "center", l: p.x - wd / 2, r: p.x + wd / 2, price: 2 });
      return { p, places: [...(usualLeft ? [left, right] : [right, left]), level(p.y - 20), level(p.y + 20)] };
    });
    // the clashes of one layout: a name off the map, two names that cross, a name over another galaxy's ring
    const clashes = (pick) => {
      let n = 0;
      pick.forEach((a, i) => {
        if (a.l < EDGE || a.r > this.w - EDGE || a.y - H < fl.t - 16 || a.y + H > fl.b + 8) n++;
        pick.forEach((b, j) => {
          if (j > i && a.l < b.r + 2 && b.l < a.r + 2 && Math.abs(a.y - b.y) < 2 * H + 2) n++;
          const c = choices[j].p;
          if (j !== i && a.l < c.x + RING && c.x - RING < a.r && Math.abs(a.y - c.y) < H + RING) n++;
        });
      });
      return n;
    };
    // I try every layout (four places for each of the three names: 64 layouts) and keep the cheapest one;
    // a clash costs far more than any move, so a layout without a clash always wins
    let best = choices.map((c) => c.places[0]), bestCost = Infinity;
    const layouts = choices.length <= 5 ? 4 ** choices.length : 1;
    for (let code = 0; code < layouts; code++) {
      const pick = choices.map((c, i) => c.places[Math.floor(code / 4 ** i) % 4]);   // code written in base 4: one digit per name
      const cost = pick.reduce((s, a) => s + a.price, 0) + 100 * clashes(pick);
      if (cost < bestCost) { best = pick; bestCost = cost; }
      if (cost === 0) break;                                  // the usual places are all free: nothing moves
    }
    return new Map(named.map((m, i) => [m, best[i]]));
  }

  /** One frame of the sky; t is the time in ms given by requestAnimationFrame. */
  frame(t) {
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);                 // I work in real canvas pixels to clear it
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // a very slow drift, so the sky feels alive without anything moving on its own
    const dx = this.reduced ? 0 : Math.sin(t / 9000) * 3 * this.ratio, dy = this.reduced ? 0 : Math.cos(t / 12000) * 2 * this.ratio;
    // two faint axis lines along the left and bottom edges of the sky
    const fl = this.field(this.w, this.h);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.strokeStyle = "rgba(238,241,255,0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fl.l - 10, fl.t - 4); ctx.lineTo(fl.l - 10, fl.b + 10); ctx.lineTo(fl.r, fl.b + 10);
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // the fade between looks: u goes from 0 to 1 over FADE_MS
    const { prev, cur, t0 } = this.layers;
    const u = prev && !this.reduced ? Math.min(1, (t - t0) / FADE_MS) : 1;
    if (prev && u < 1) this.drawLayers(ctx, prev, 1 - u, t, dx, dy);   // the old look, fading out
    if (cur) this.drawLayers(ctx, cur, u, t, dx, dy);                    // the new look, fading in
    ctx.globalAlpha = 1;
    if (this.marks && this.marks.length) {
      // the marks move with the drift (dx, dy), so they stay on their galaxies
      ctx.setTransform(this.ratio, 0, 0, this.ratio, dx, dy);
      ctx.font = "600 13px Figtree, 'Segoe UI', sans-serif";
      ctx.textBaseline = "middle";
      const names = this.placeNames(ctx);                      // the place of each remarkable galaxy's name
      const backed = (draw) => {                               // the light bands pass behind: the names get a soft dark halo
        ctx.shadowColor = "rgba(3,4,11,0.95)"; ctx.shadowBlur = 7 * this.ratio;
        draw();
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
      };
      this.marks.forEach((m, k) => {
        const p = this.toScreen(m), on = k === this.activeMark;
        if (on && !m.kind) {                                     // the card under the pointer: its galaxy glows and pulses
          const phase = this.reduced ? 0.35 : (t / 1400) % 1;   // 0 -> 1 every 1.4 s: the ring grows and fades
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
          glow.addColorStop(0, "rgba(238,241,255,0.35)"); glow.addColorStop(1, "rgba(238,241,255,0)");
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, 2 * Math.PI); ctx.fill();
          ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - phase)})`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 11 + phase * 18, 0, 2 * Math.PI); ctx.stroke();
          if (this.markFrom) {                                   // a faint line from the card to its galaxy
            const f = this.markFrom, a = Math.atan2(p.y - f.y, p.x - f.x);   // the line's direction
            ctx.save(); ctx.setLineDash([4, 5]);
            // the card does not drift, so I take the drift back off its end of the line
            ctx.beginPath(); ctx.moveTo(f.x - dx / this.ratio, f.y - dy / this.ratio);
            ctx.lineTo(p.x - Math.cos(a) * 13, p.y - Math.sin(a) * 13);   // I stop 13 px short of the galaxy
            ctx.strokeStyle = "rgba(3,4,11,0.8)"; ctx.lineWidth = 3.5; ctx.stroke();       // a dark edge, so it reads over the bright cloud
            ctx.strokeStyle = "rgba(238,241,255,0.8)"; ctx.lineWidth = 1.3; ctx.stroke(); ctx.restore();
          }
        }
        if (m.kind === "on" || m.kind === "off") {            // a galaxy you have met: a small dot in the colour of its fate
          const c = m.kind === "off" ? "224,69,90" : "91,143,214";
          ctx.fillStyle = `rgb(${c})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI); ctx.fill();
          ctx.strokeStyle = `rgba(${c},0.55)`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, 2 * Math.PI); ctx.stroke();
          if (this.w < 700) return;                           // a phone: the dot alone (names would crowd the small map)
          const right = p.x > this.w * 0.8;                     // near the right edge the name goes on the left
          ctx.textAlign = right ? "right" : "left";
          ctx.font = "500 11px Figtree, 'Segoe UI', sans-serif";
          const lx = p.x + (right ? -11 : 11);
          ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(3,4,11,0.9)";
          backed(() => ctx.strokeText(m.label, lx, p.y));
          ctx.fillStyle = "rgba(238,241,255,0.62)";
          ctx.fillText(m.label, lx, p.y);
          ctx.font = "600 13px Figtree, 'Segoe UI', sans-serif";   // back to the font of the named galaxies
          return;
        }
        // a named (remarkable) galaxy: a ring and its name, brighter when it is the active one
        ctx.strokeStyle = on ? "#fff" : "rgba(238,241,255,0.7)";
        ctx.lineWidth = on ? 2 : 1.2;
        ctx.beginPath(); ctx.arc(p.x, p.y, on ? 11 : 8, 0, 2 * Math.PI); ctx.stroke();
        const at = names.get(m);                                 // where its name goes (worked out by placeNames)
        ctx.textAlign = at.align;
        ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(3,4,11,0.92)";
        backed(() => ctx.strokeText(m.label, at.x, at.y));
        ctx.fillStyle = on ? "#fff" : "rgba(238,241,255,0.8)";
        ctx.fillText(m.label, at.x, at.y);
      });
    }
    if (!this.player) return;                            // no galaxy chosen yet: the frame is done
    // the player's galaxy: a point with a slow pulse
    ctx.setTransform(this.ratio, 0, 0, this.ratio, dx, dy);
    const p = this.playerScreen();
    const phase = this.reduced ? 0.4 : (t / 1800) % 1;   // 0 -> 1 every 1.8 s
    ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - phase)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6 + phase * 22, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI); ctx.fill();
    if (this.mode.kind === "chance") {
      ctx.font = "600 14px Figtree, 'Segoe UI', sans-serif";
      ctx.textBaseline = "middle";
      const right = p.x > this.w * 0.82;
      ctx.textAlign = right ? "right" : "left";
      ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(3,4,11,0.92)";
      const lx = p.x + (right ? -16 : 16);
      // a dark outline first, then the white text over it, so it reads over bright points
      ctx.strokeText("your galaxy", lx, p.y);
      ctx.fillText("your galaxy", lx, p.y);
    }
  }
}
