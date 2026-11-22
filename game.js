// WILL IT SWITCH OFF? The galaxy game.
// Choose a kind of galaxy in a sky of 12,710 real galaxies, watch its real past, bet, let the model bet,
// then watch the real future and see the truth back in the sky.
// Data: data/game.json and data/map.json (built by src/game_assets.py); films and 3D files in
// media/<galaxy id>/ (or MEDIA_ONLINE, the online copy of that folder, see block 0).
//
// BLOCK MAP of this file (the same numbers as in docs/game/CODE_GUIDE.md and the other files):
//   0. SETTINGS AND STATE        the page's options, timings, words, and the one `state` object of a round
//   1. DATA                      where the media files are, and what the player has already met (localStorage)
//   2. DATA PROCESSING           the player's answers -> a box -> a galaxy; which points of the sky fit; counts
//   3. RENDERING                 (not here: sky.js draws the sky, viewer3d.js the 3D view, the films come from Python)
//   4. INTERFACE AND ANIMATIONS  every screen of the game, in the order a player meets them:
//        4a screens and transitions   4b choosing a galaxy         4c the film
//        4d the suspense and gauge    4e the verdict               4f the remarkable galaxies
//        4g full screen               4h the 3D view and its bar   4i the opening
//   5. SOUND                     (not here: sound.js listens to the body's data-screen / data-mode / data-galaxy)
//   6. WIRING                    init(): I load the data, build the sky and connect every button
//
// Blocks 0 to 4 only define things; init(), in block 6 at the very bottom, is what starts the game.
import { drawSsfr, drawFuel, drawDistance, hasHostDistance, drawTimeCurve, filmPosition, lookbackAt, percent } from "./charts.js";
import { Sky } from "./sky.js";

// =====================================================================================================
// 0. SETTINGS AND STATE
// =====================================================================================================
// The page's options (from the address bar), the timings of the animations, the words shown on screen, and the
// one object `state` that remembers where the player is in a round (which galaxy, which film, which bet...).

// Where the heavy media files (films, 3D clouds, stills) are. Online they come from MEDIA_ONLINE (a Cloudflare R2
// bucket, the same folders as media/); on this computer (localhost) the page reads the local media/ folder.
// ?media=<address> in the address bar overrides both (for example to test the online files from localhost).
const MEDIA_ONLINE = "https://pub-d65907a2314b451f93eec089912119be.r2.dev/";
const LOCAL = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
const MEDIA_BASE = new URLSearchParams(location.search).get("media") || (LOCAL || !MEDIA_ONLINE ? "media/" : MEDIA_ONLINE);

// The live chart under the film: A (star formation) and the fuel gauge (star-forming gas left), chosen by the student.
const CHARTS = [
  { id: "ssfr", label: "star formation", draw: drawSsfr },
  { id: "fuel", label: "fuel left", draw: drawFuel },
  { id: "distance", label: "distance to the big galaxy", draw: drawDistance, only: hasHostDistance },   // satellites only
];

// what the model reads, shown one after the other while it "thinks" (the 17 inputs, in plain words)
const MODEL_INPUTS = ["its mass of stars", "how fast it makes stars", "its gas compared with its stars", "its size",
  "the mass of its dark-matter halo", "its black hole's mass", "how fast its black hole grows", "whether it has a black hole",
  "whether it is alone or a satellite", "the black hole's wind energy", "the black hole's heating energy",
  "whether the wind mode is on", "the share of wind energy", "its distance to the centre of its group",
  "its neighbours within 3.7 million light years", "its neighbours within 7.4 million light years",
  "the distance to the nearest big galaxy"];
const THINK_MS = 5600, THINK_HOLD_MS = 800;   // the model reading its 17 numbers (a little slower than at first, to read)
const MID_PAUSE_MS = 1200;                    // a galaxy met again or previewed (no bet): a short pause between its past and its future
// The suspense of the future (seconds): the end of the film is slowed down, a short black, then the verdict in
// large type. From the third time on, a shorter version.
const SUSPENSE = {
  long: { slowSpan: 0.6, slowRate: 0.3, black: 0.4, word: 1.1 },
  short: { slowSpan: 0.4, slowRate: 0.4, black: 0.3, word: 0.8 },
};
let suspenseCount = 0;
// the remarkable galaxies of the home page play straight through: no pause between past and future, no slowed end
// (the short black and the verdict in large type stay)
const straightThrough = () => state.mode === "showcase";
const KEYS = ["size", "gas", "wind", "place"];
const SHORT = {                       // the answers as short words, for the row of answers given so far
  size: { small: "Small", medium: "Medium", large: "Large" },
  gas: { "lots of gas": "Lots of gas", "some gas": "Some gas", "little gas": "Little gas" },
  wind: { quiet: "Quiet black hole", "blowing wind": "Black-hole wind" },
  place: { alone: "Alone", "orbiting a bigger galaxy": "Around a bigger galaxy" },
};
const ICON_RIGHT = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>';
const ICON_WRONG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (id) => document.getElementById(id);
const state = { mode: "game", choice: {}, q: 0, galaxy: null, box: null, clip: "past", clipDone: false, guess: null, verdict: false,
  rewatch: false, rounds: 0, you: 0, model: 0, chart: CHARTS[0].id, sus: null };
let game, sky, viewer, edges, mapData;

// ?preview=sharp: the same game with a few galaxies in a sharper rendering style (data/game_preview.json;
// those galaxies carry their own "media_dir"). The normal page is unchanged.
const PREVIEW = new URLSearchParams(location.search).get("preview") === "sharp";
// ?films=motion: the same game with new films for some galaxies (data/game_motion.json; those galaxies carry their
// own "media_dir"), until they are approved. Without that file the page falls back to the usual game.json.
const MOTION = new URLSearchParams(location.search).get("films") === "motion";

// =====================================================================================================
// 1. DATA: the media files and what the player has met
// =====================================================================================================
// The game's data itself (game.json, map.json) is loaded in init() (block 6). Here: where each galaxy's films and
// 3D files are, and the browser's memory (localStorage), so a player who comes back finds the galaxies they
// already met. If the browser blocks storage, I simply remember for this visit only.

// I build the address of one of a galaxy's files (its own folder if it has one, else media/<id>/).
function media(galaxy, name) { return `${galaxy.media_dir || MEDIA_BASE}${galaxy.id}/${name}`; }

const PLAYED_KEY = "will-it-switch-off:played";
const played = new Map();                      // "size|gas|wind|place" -> id of the galaxy that played
try {
  const saved = JSON.parse(localStorage.getItem(PLAYED_KEY) || "{}");
  for (const [k, v] of Object.entries(saved)) played.set(k, v);
} catch (error) { /* private window or storage blocked: remember for this visit only */ }

const boxKey = (b) => KEYS.map((k) => b[k]).join("|");

// every galaxy the player has met, for the map of the home page (a box can hold two, so they are kept apart)
const FOUND_KEY = "will-it-switch-off:found";
const found = new Set();
try { for (const id of JSON.parse(localStorage.getItem(FOUND_KEY) || "[]")) found.add(String(id)); } catch (error) { /* this visit only */ }
for (const id of played.values()) found.add(String(id));

function rememberPlayed(box, galaxy) {
  played.set(boxKey(box), galaxy.id);
  found.add(String(galaxy.id));
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify(Object.fromEntries(played)));
    localStorage.setItem(FOUND_KEY, JSON.stringify([...found]));
  } catch (error) { /* this visit only */ }
}

// =====================================================================================================
// 2. DATA PROCESSING: from the player's answers to a galaxy
// =====================================================================================================
// The four answers (size, gas, black hole, where it lives) make a "box" of galaxies (cut by src/game_assets.py).
// Here I find the box, pick the galaxy whose film plays, find which points of the sky fit the answers so far,
// count them, and turn a snapshot number into "billion years ago".

function findBox() {
  const { size, gas, wind, place } = state.choice;
  return game.boxes.find((b) => b.size === size && b.gas === gas && b.wind === wind && b.place === place) || null;
}

function pickGalaxy(box) {
  // the most typical galaxy of the box; where more than 5 % of the box switched off, the box's most typical
  // switched-off galaxy plays instead, as often as such galaxies really occur (chance = the box's real share)
  const useQuencher = box.quencher && (!box.keeper || Math.random() < box.quenched_share);
  return game.galaxies[String(useQuencher ? box.quencher : box.keeper)];
}

/** Tertile edges of the pool on the sky's two axes: the same cut as the size and gas answers. */
function tertiles(values) {
  // I sort the values and read them at one third and two thirds of the way
  const s = Float64Array.from(values).sort();
  return [s[Math.floor(s.length / 3)], s[Math.floor((2 * s.length) / 3)]];
}

/** Which galaxies of the sky fit the answers given so far (wind only once map.json carries it). */
function litMask() {
  const c = state.choice, n = sky.n, lit = new Uint8Array(n);
  if (sky.box) {                                  // exact: each galaxy's box, as cut by src/game_assets.py
    const fits = game.boxes.map((b) => KEYS.every((k) => !c[k] || b[k] === c[k]));
    for (let i = 0; i < n; i++) lit[i] = fits[sky.box[i]] ? 1 : 0;
    return lit;
  }
  // otherwise (an older map.json) I cut the sky's axes myself: 0, 1 or 2 = below, between or above the two edges
  const tier = (v, [a, b]) => (v < a ? 0 : v < b ? 1 : 2);
  const SIZE = { small: 0, medium: 1, large: 2 }, GAS = { "little gas": 0, "some gas": 1, "lots of gas": 2 };
  for (let i = 0; i < n; i++) {
    lit[i] = (!c.size || tier(sky.x[i], edges.size) === SIZE[c.size])
      && (!c.gas || tier(sky.y[i], edges.gas) === GAS[c.gas])
      && (!c.place || (c.place === "alone") === (sky.central[i] === 1))
      && (!c.wind || !sky.wind || (c.wind === "blowing wind") === (sky.wind[i] === 1)) ? 1 : 0;
  }
  return lit;
}

/** Number of pool galaxies that fit the answers so far (exact, from the boxes). */
function countFitting() {
  // I keep the boxes that agree with every answer given (an unanswered question accepts all), and add up their sizes
  return game.boxes.filter((b) => KEYS.every((k) => !state.choice[k] || b[k] === state.choice[k]))
    .reduce((sum, b) => sum + b.n, 0);
}

/** How long ago a snapshot was (billion years), read from the current galaxy's series. */
function lookbackOf(snap) {
  const s = state.galaxy.series;
  return s.lookback[s.snap.indexOf(snap)];
}

/** How long ago a snapshot was, in billion years, read from any galaxy's series (null if unknown). */
function agoAt(snap) {
  const ser = Object.values(game.galaxies).map((g) => g.series).find((s) => s && s.snap && s.snap.includes(snap));
  return ser ? ser.lookback[ser.snap.indexOf(snap)] : null;
}

// =====================================================================================================
// 3. RENDERING
// =====================================================================================================
// Nothing is drawn in this file. The sky of points is drawn by sky.js (class Sky), the 3D galaxy by viewer3d.js
// (class GalaxyViewer, loaded only when the player opens the 3D view), the live charts by charts.js, and the
// galaxy films are MP4 files rendered beforehand in Python (src/tng_game_render.py, src/game_showcase_motion.py).

// =====================================================================================================
// 4. INTERFACE AND ANIMATIONS
// =====================================================================================================
// Every screen of the game and how it moves, in the order a player meets them. The screens are <section>s of
// index.html; go(name) shows one by setting <body data-screen="name">, and game.css does the rest.

// -----------------------------------------------------------------------------------------------------
// 4a. SCREENS AND TRANSITIONS
// -----------------------------------------------------------------------------------------------------
// go() changes the screen; the screen you leave slides out as a copy (leaveScreen); on a phone the sky takes
// the room above the text (fitSky).

/** The order of the screens, to tell going forward from coming back. */
const SCREEN_RANK = { home: 0, showcase: 1, choose: 1, meet: 2, film: 3, verdict: 4, "3d": 5 };

function go(screen) {
  if (screen !== "film") { clearInterval(preload.timer); dropPreload(); }   // no film loading for a screen without it
  const from = document.body.dataset.screen;
  if (from && from !== screen) {
    const dir = (SCREEN_RANK[screen] ?? 0) < (SCREEN_RANK[from] ?? 0) ? "back" : "forward";
    document.body.dataset.dir = dir;
    leaveScreen(from, dir);
    document.body.classList.remove("intro-done");    // the slower first entrance after the opening is over
  }
  // for the music: the kind of play (a game, a remarkable galaxy = "showcase", ...) and, for a remarkable galaxy, its id
  document.body.dataset.mode = state.mode;
  document.body.dataset.galaxy = state.mode === "showcase" && state.galaxy ? String(state.galaxy.id) : "";
  document.body.dataset.screen = screen;
  if (screen === "home" && game && sky) sky.setMarks(homeMarks());   // the home page's map: what you have met, and the three
  window.scrollTo(0, 0);
  fitSky();
}

/** The screen you leave slides out and fades, as a copy over the page (the real one is already gone, so nothing
 *  waits for the animation). The film and the 3D view hold a film or a 3D scene, so they leave without a copy. */
function leaveScreen(from, dir) {
  document.querySelectorAll("[data-morphed]").forEach((el) => el.removeAttribute("data-morphed"));
  if (REDUCED || document.body.classList.contains("intro-on") || document.body.classList.contains("morphing")) return;
  const old = $(`screen-${from}`);
  if (!old || old.querySelector("video, canvas")) return;
  const r = old.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const ghost = old.cloneNode(true);
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.classList.add("ghost");
  if (dir === "back") ghost.classList.add("back");
  // its layout as it was (some of it depends on the screen shown, which has already changed)
  const cs = getComputedStyle(old);
  Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    right: "auto", bottom: "auto", margin: "0", display: cs.display, flexDirection: cs.flexDirection,
    justifyContent: cs.justifyContent, alignItems: cs.alignItems, gap: cs.gap });
  old.after(ghost);                                  // after the real one, which every lookup still finds first
  setTimeout(() => ghost.remove(), 220);
}

/** On a narrow screen the sky fills the room above the text: as tall as the free space allows (at
 *  least 200 px, at most 62 % of the screen), and the text starts right below it. */
const NARROW = window.matchMedia("(max-width: 899px) and (max-aspect-ratio: 6/5), (max-height: 479px), (max-width: 1099px) and (max-height: 699px)");   // the same query as the narrow layout in game.css
function fitSky() {
  if (!sky) return;
  const root = document.documentElement.style;
  const rail = document.querySelector(`#screen-${document.body.dataset.screen}.rail`);
  if (!NARROW.matches || !rail) { root.removeProperty("--sky-h"); sky.setField(null); return; }
  const h = window.innerHeight, w = window.innerWidth;
  const skyH = Math.round(Math.min(h * 0.62, Math.max(200, h * 0.34, h - rail.offsetHeight)));
  root.setProperty("--sky-h", `${skyH}px`);
  // keep the sky's shape: no wider than 2.4 times its height (a short landscape screen)
  const top = 92, bottom = Math.max(150, skyH - 44), half = Math.min(w * 0.43, ((bottom - top) * 2.4) / 2);
  sky.setField({ l: w / 2 - half, r: w / 2 + half, t: top, b: bottom });
}

// -----------------------------------------------------------------------------------------------------
// 4b. CHOOSING A GALAXY: four questions, a rolling counter, a narrowing sky
// -----------------------------------------------------------------------------------------------------
// One question at a time. Each answer narrows the sky to the galaxies that fit and rolls the counter down;
// answers that lead to no film are dimmed. Once the four are given, "Watch its past" appears.

// ---- how many galaxies fit: a counter whose digits roll on reels, right beside the open question. A choice rolls it
// down while the galaxies that no longer fit fade out of the sky; then the next question comes in and the counter
// glides to it. Once the four answers are given, it glides down to the line above "Watch its past".
const ODO_MS = 600;                 // the leftmost digits settle first, the last two roll a little longer
const ADVANCE_MS = 860;             // a choice, its count rolling down, then the next question
const REST = 30;                    // a reel holds five turns of 0 to 9; at rest it shows the fourth (room either way)
const odo = { slots: [], value: null, dw: 0 };
let advanceTimer = 0;

function odoSlot(comma) {
  const el = document.createElement("span");
  if (comma) { el.className = "odo-c"; el.textContent = ","; return { comma, el }; }
  el.className = "odo-d";
  const reel = document.createElement("span");
  reel.className = "odo-reel";
  reel.innerHTML = "<i>0</i><i>1</i><i>2</i><i>3</i><i>4</i><i>5</i><i>6</i><i>7</i><i>8</i><i>9</i>".repeat(5);
  el.appendChild(reel);
  return { comma, el, reel, token: 0 };
}

function odoPlace(s, at, ms = 0) {
  s.reel.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.2, 0.75, 0.25, 1)` : "none";
  s.reel.style.transform = `translateY(${(-at).toFixed(3)}em)`;
}

/** One reel to digit d: down (the digit falls, counting down) or up, with extra whole turns on the right. */
function odoRoll(s, d, down, turns, ms) {
  const cs = getComputedStyle(s.reel), px = parseFloat(cs.fontSize) || 16;
  const now = cs.transform && cs.transform !== "none" ? -new DOMMatrixReadOnly(cs.transform).m42 / px : REST + d;
  const from = REST + (((now % 10) + 10) % 10);       // the same picture, moved to the middle turn
  let to = REST + d;
  if (Math.abs(from - to) < 0.01 && !turns) { odoPlace(s, to); return; }
  if (down) { if (to >= from - 0.01) to -= 10; to -= 10 * turns; } else if (to <= from + 0.01) to += 10;
  const token = ++s.token;                            // a newer roll of this reel cancels the "back to rest" below
  odoPlace(s, from);
  void s.reel.offsetWidth;                            // I make the browser apply the start position before the roll
  odoPlace(s, to, ms);
  setTimeout(() => { if (s.token === token) odoPlace(s, REST + d); }, ms + 40);   // back to rest, unseen
}

/** The counter to value n (rolling, or at once). */
function showCount(n, animate = true) {
  const box = $("count");
  if (!odo.slots.length) box.textContent = "";
  if (!odo.dw) {                                     // the width of a digit in this font (on screen, its font loaded)
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
    box.appendChild(probe);
    let w = 0;
    for (const c of "0123456789") { probe.textContent = c; w = Math.max(w, probe.getBoundingClientRect().width); }
    probe.remove();
    const fs = parseFloat(getComputedStyle(box).fontSize), ready = !document.fonts || document.fonts.check(`300 ${fs}px Unbounded`);
    if (w > 0 && fs > 0 && ready) { odo.dw = w / fs; box.style.setProperty("--dw", `${odo.dw.toFixed(3)}em`); }
    else if (w > 0 && fs > 0 && !odo.waiting) {      // the font still loading: measure again once it is there
      odo.waiting = true;
      document.fonts.load(`300 ${fs}px Unbounded`).then(() => { odo.dw = 0; odo.waiting = false; if (odo.value !== null) showCount(odo.value, false); }).catch(() => {});
    }
  }
  const old = odo.value, roll = animate && !REDUCED && old !== null && old !== n, down = old !== null && n < old;
  // I read the number from right to left ("1,328" -> 8, 2, 3, ",", 1), so slot 0 is always the units
  const chars = [...n.toLocaleString("en")].reverse(), digits = chars.filter((c) => c !== ",").length;
  const len = Math.max(chars.length, odo.slots.length);
  let place = 0;
  for (let i = 0; i < len; i += 1) {
    const c = chars[i];
    let s = odo.slots[i];
    if (c === undefined) {                            // a place the number no longer has: it folds away
      if (s && !s.el.classList.contains("odo-out")) {
        s.el.classList.add("odo-out");
        const el = s.el;
        setTimeout(() => { if (el.classList.contains("odo-out")) { el.remove(); odo.slots = odo.slots.filter((x) => x.el !== el); } }, 450);
      }
      continue;
    }
    if (!s) {                                         // a new place on the left: it opens
      s = odoSlot(c === ",");
      odo.slots[i] = s;
      box.prepend(s.el);
      if (roll) { s.el.classList.add("odo-out"); requestAnimationFrame(() => requestAnimationFrame(() => s.el.classList.remove("odo-out"))); }
      if (!s.comma) odoPlace(s, REST + Number(c));
    } else s.el.classList.remove("odo-out");
    if (s.comma) continue;
    const d = Number(c);
    if (!roll) { s.token += 1; odoPlace(s, REST + d); }
    else {
      // a big drop spins the right-hand reels a whole extra turn or two, like a real counter
      const turns = down && Math.abs(old - n) >= 10 ** (place + 1) ? (place === 0 ? 2 : 1) : 0;
      odoRoll(s, d, down, turns, ODO_MS + (place === 0 ? 140 : place === 1 ? 70 : 0) - (digits - 1 - place > 2 ? 60 : 0));
    }
    place += 1;
  }
  odo.value = n;
  box.dataset.value = String(n);
  setCountWords(n);
}

/** The words with the count. */
function setCountWords(n) {
  const words = n === 1 ? "galaxy like this" : "galaxies like this";
  $("count-text").textContent = words;
  $("count-say").textContent = `${n.toLocaleString("en")} ${words}`;
}

/** The counter's place: beside the open question while answers are missing, above the button once all are given. */
function placeCount() {
  const end = $("screen-choose").classList.contains("complete");
  const home = end ? $("count-end") : document.querySelectorAll(".question")[state.q]?.querySelector(".q-head");
  if (home && $("count-box").parentElement !== home) home.appendChild($("count-box"));
  if (odo.value !== null) setCountWords(odo.value);
}

/** A change of question (or of the counter's place), as one smooth step: the old fades, the new rises, and the
 *  counter glides from its old place to its new one. */
function smoothly(update) {
  if (!document.startViewTransition || REDUCED || document.body.dataset.screen !== "choose") { update(); return; }
  const box = $("count-box");
  box.style.viewTransitionName = "galaxy-count";
  const t = document.startViewTransition(update);
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(() => {});
  t.finished.catch(() => {}).finally(() => { box.style.viewTransitionName = ""; });
}

/** After a choice: the next question still open, or, all four given, the line above the button. */
function advance() {
  const next = KEYS.findIndex((k) => !state.choice[k]);
  smoothly(() => {
    if (next >= 0) { showQuestion(next); return; }
    $("screen-choose").classList.add("complete");
    placeCount();
    fitSky();
    ($("go-past").hidden ? $("met-other") : $("go-past")).focus({ preventScroll: true });
  });
}

/** Dim the answers that, with the answers already given, lead to no galaxy with a film. */
function markPlayable() {
  // each question looks only at the answers before it, so an answer is never blocked by a later one
  const playable = game.boxes.filter((b) => b.keeper || b.quencher);
  document.querySelectorAll(".question").forEach((qEl) => {
    const key = qEl.dataset.key, before = KEYS.slice(0, KEYS.indexOf(key));
    qEl.querySelectorAll(".option").forEach((o) => {
      const reach = playable.filter((b) => b[key] === o.dataset.value && before.every((k) => !state.choice[k] || b[k] === state.choice[k]));
      const ok = reach.length > 0, fresh = reach.some((b) => !played.has(boxKey(b)));
      o.disabled = !ok;
      o.classList.toggle("unavailable", !ok);
      o.classList.toggle("met", ok && played.size > 0 && !fresh);
      o.classList.toggle("fresh", ok && played.size > 0 && fresh);
      o.title = !ok ? "No galaxy with a film has this mix of answers yet" : !fresh && played.size ? "You have already met the galaxies this answer leads to" : "";
    });
  });
}

/** The answers so far. On a phone: a row of small pills and dots above the question. On a wider screen:
 *  the four questions as stops on a line beside the sky (the open question sits at its own stop). */
const TOPIC = { size: "Size", gas: "Gas", wind: "Black hole", place: "Where it lives" };
function renderSteps() {
  // the stops after the open question are also drawn in a second list placed after the questions, so on a
  // wider screen the keyboard meets them in the order they are drawn (each list hides the copy it does not use)
  const ol = $("steps"), next = $("steps-next");   // next: absent from a page cached before it existed
  ol.innerHTML = "";
  if (next) next.innerHTML = "";
  KEYS.forEach((k, i) => {
    ol.appendChild(stepItem(k, i));
    if (next && i > state.q) {
      ol.lastChild.classList.add("later");
      next.appendChild(stepItem(k, i));
    }
  });
}

/** One stop: an answer given (a button to change it) or a question still to come. */
function stepItem(k, i) {
  const li = document.createElement("li"), topic = document.createElement("span");
  li.dataset.key = k;
  li.classList.toggle("now", i === state.q);
  topic.className = "topic";
  topic.textContent = TOPIC[k];
  if (state.choice[k]) {
    const b = document.createElement("button"), pill = document.createElement("span"), word = document.createElement("span");
    const option = document.querySelector(`.question[data-key="${k}"] .option[data-value="${state.choice[k]}"]`);
    pill.className = "pill";
    pill.textContent = SHORT[k][state.choice[k]];
    word.className = "word";
    word.textContent = option ? option.firstChild.textContent.trim() : pill.textContent;   // the answer's own words
    b.append(topic, pill, word);
    b.setAttribute("aria-label", `Change ${TOPIC[k].toLowerCase()}: ${SHORT[k][state.choice[k]]}`);
    if (i === state.q) b.setAttribute("aria-current", "step");
    b.onclick = () => smoothly(() => showQuestion(i));
    li.classList.add("done");
    li.appendChild(b);
  } else {
    const s = document.createElement("span");
    s.className = "todo";
    s.appendChild(topic);
    li.setAttribute("aria-hidden", "true");     // a question still to come, not an answer
    li.appendChild(s);
  }
  return li;
}

function showQuestion(i) {
  clearTimeout(advanceTimer);
  state.q = i;
  $("screen-choose").classList.remove("complete");
  document.querySelectorAll(".question").forEach((qEl, j) => { qEl.hidden = j !== i; });
  placeCount();
  renderSteps();
  fitSky();
}

function updateChoice(animate = true) {
  updateChoiceText(animate);
  fitSky();                                       // notes and buttons change the height of the text
}

function updateChoiceText(animate = true) {
  markPlayable();
  renderSteps();
  const answered = KEYS.filter((k) => state.choice[k]);
  sky.set(answered.length ? { kind: "narrow", lit: litMask() } : { kind: "plain" });
  showCount(countFitting(), animate);
  const note = $("box-note"), goPast = $("go-past");
  note.hidden = true;
  goPast.hidden = true;
  $("met-note").hidden = $("met-other").hidden = $("met-again").hidden = true;
  if (answered.length < KEYS.length) return;
  const box = findBox();
  if (!box || !(box.keeper || box.quencher)) {
    note.hidden = false;
    note.textContent = box && box.n > 0
      ? "The film of this galaxy is not ready yet. Please change one answer."
      : "No galaxy in our sample has this mix (small galaxies almost never have a black hole in wind mode). Please change one answer.";
    return;
  }
  if (played.has(boxKey(box)) && game.galaxies[String(played.get(boxKey(box)))]) {
    $("met-note").hidden = $("met-other").hidden = $("met-again").hidden = false;
    return;
  }
  goPast.hidden = false;
  if (box.n < 20) {
    note.hidden = false;
    note.textContent = `A rare kind: only ${box.n} ${box.n === 1 ? "galaxy" : "galaxies"} of our sample ${box.n === 1 ? "looks" : "look"} like this, so the share shown at the end is uncertain.`;
  }
}

function answer(key, value, button = null) {
  // changing an earlier answer clears the later ones, which may no longer fit
  if (state.choice[key] !== value) KEYS.slice(KEYS.indexOf(key) + 1).forEach((k) => clearAnswer(k));
  state.choice[key] = value;
  document.querySelectorAll(`.question[data-key="${key}"] .option`)
    .forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.value === value)));
  if (button && !REDUCED) {                         // the press, at once (and only once: not again when the question comes back)
    button.classList.remove("chosen");
    void button.offsetWidth;
    button.classList.add("chosen");
    button.addEventListener("animationend", () => button.classList.remove("chosen"), { once: true });
  }
  clearTimeout(advanceTimer);
  // the press shows at once; the sky and the counter follow on the next frame (redrawing the sky takes a moment)
  requestAnimationFrame(() => setTimeout(() => {
    updateChoice();
    if ($("screen-choose").classList.contains("complete")) return;   // the last answer changed: the counter rolls where it is
    advanceTimer = setTimeout(advance, REDUCED ? 0 : ADVANCE_MS);
  }, 0));
}

function clearAnswer(key) {
  delete state.choice[key];
  document.querySelectorAll(`.question[data-key="${key}"] .option`).forEach((o) => o.setAttribute("aria-pressed", "false"));
}

/** A new round starts with no answers: the whole sky, question one. */
function openChoose() {
  endSuspense();
  KEYS.forEach(clearAnswer);
  sky.setPlayer(null);                             // no point is "yours" before you pick (e.g. the opening's pulse)
  sky.setMarks([]);                                // nor the home page's marks
  go("choose");
  const next = KEYS.findIndex((k) => !state.choice[k]);
  showQuestion(next >= 0 ? next : 0);
  updateChoice(false);                             // the whole sky's count, at once
}

// -----------------------------------------------------------------------------------------------------
// 4c. THE FILM: the past, the bet, the model thinking
// -----------------------------------------------------------------------------------------------------
// The film player: it plays the past (or future) clip, preloads the next one, keeps the stars film in step, and on
// every frame (tick) writes the labels over the film and draws the live chart under it. For a remarkable galaxy
// the future takes over from the past without a cut (the "handoff"). Then the player bets and the model "reads".

const film = () => $("film");
const starsFilm = () => $("film-stars");
const hasFilm = (name) => Boolean(state.galaxy && (state.galaxy.films ? state.galaxy.films.includes(name) : name === "past" || name === "future"));
const isClean = (clip = state.clip) => hasFilm(`${clip}_clean`);

function setPhase(name) {
  document.querySelectorAll(".console .phase").forEach((p) => { p.hidden = p.dataset.phase !== name; });
}

function playClip(clip, autoplay = true) {
  state.clip = clip;
  state.clipDone = false;
  dropPreload();                                    // let go of the early copy first: the film then reads what it loaded
  const v = film(), s = starsFilm(), clean = isClean(clip);
  v.playbackRate = s.playbackRate = 1;
  const { inset, files } = clipFiles(clip), stars = Boolean(inset);
  $("film-box").classList.toggle("clean", clean);
  $("film-box").classList.toggle("inset-big", stars && state.galaxy.style === "motion");
  // the size of that box in the film's 1920 x 1080 frame, if the galaxy gives it (else 540, see game.css)
  if (state.galaxy.stars_inset_px > 0) $("film-box").style.setProperty("--inset", String(state.galaxy.stars_inset_px));
  else $("film-box").style.removeProperty("--inset");
  setFilmState("loading");
  v.src = media(state.galaxy, files[0]);
  v.currentTime = 0;
  s.hidden = !stars;
  $("l-stars").hidden = !stars;
  $("l-stars").textContent = inset || "";
  if (stars) { s.src = media(state.galaxy, files[1]); s.currentTime = 0; }
  else s.removeAttribute("src");
  if (autoplay) v.play().catch(() => {});       // else it waits on its first frame (the moment of the bet)
  // once the past is fully downloaded (the connection then has room to spare), the future starts loading while the
  // past plays: no wait at the cut. On a slow connection the past keeps all of it (no stalls added).
  clearInterval(preload.timer);
  if (clip === "past") {
    const g = state.galaxy;
    preload.timer = setInterval(() => {
      if (state.clip !== "past" || state.galaxy !== g) { clearInterval(preload.timer); return; }
      if (loaded(film()) && (starsFilm().hidden || loaded(starsFilm()))) { clearInterval(preload.timer); preloadClip("future"); }
    }, 500);
  }
}

/** Whether a film is downloaded to its end. */
function loaded(v) {
  const b = v.buffered, d = v.duration;
  // the last downloaded piece reaches the end (I allow 0.3 s, as the last frame is often not counted)
  return Number.isFinite(d) && b.length > 0 && b.end(b.length - 1) >= d - 0.3;
}

/** A clip's files: its film (clean or with labels) and, in the clean style, its stars (or gas) film. */
function clipFiles(clip) {
  const clean = isClean(clip);
  const inset = !clean ? null : hasFilm(`${clip}_stars`) ? "stars" : hasFilm(`${clip}_gas`) ? "gas" : null;
  return { inset, files: [clean ? `${clip}_clean.mp4` : `${clip}.mp4`, ...(inset ? [`${clip}_${inset}.mp4`] : [])] };
}

/** Load a clip early in hidden copies, so the browser holds its start when the film asks for it. For a remarkable
 *  galaxy the copies of its future wait in the film itself, under the past, to take its place (see followHandoff). */
const preload = { videos: [], timer: 0, inPlace: false };
function preloadClip(clip) {
  dropPreload();
  const inPlace = clip === "future" && straightThrough() && sameLook();
  clipFiles(clip).files.forEach((file, k) => {
    const v = document.createElement("video");
    Object.assign(v, { muted: true, defaultMuted: true, playsInline: true, preload: "auto" });
    v.src = media(state.galaxy, file);
    if (inPlace) {
      v.className = k === 0 ? "film-next" : "stars-inset film-next";
      v.setAttribute("aria-hidden", "true");
      (k === 0 ? film() : starsFilm()).after(v);
    }
    preload.videos.push(v);
  });
  preload.inPlace = inPlace;
}
function dropPreload() {
  clearTimeout(handoff.timer);
  handoff.on = false;
  preload.inPlace = false;
  preload.videos.splice(0).forEach((v) => { v.remove(); v.removeAttribute("src"); v.load(); });
}

/** A remarkable galaxy's film runs on without a stop. Its past ends on the decision's moment with the camera still
 *  turning, and its future goes on from the past's very last frame: the future, loaded and paused under the past,
 *  starts as the past shows its last frame and takes the past's place as the past ends. No reload, no black. */
const handoff = { on: false, timer: 0 };
const sameLook = () => isClean("past") === isClean("future") && clipFiles("past").inset === clipFiles("future").inset;

/** Where the past film ends: its length, else the timeline it was rendered with (its last 20 frames hold the
 *  decision's moment while the camera turns on). */
function pastEnd(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  const t = game.timeline;
  // frames held at the start + frames per snapshot × snapshots before the bet + frames held on the bet, in seconds
  return (t.hold_start + t.past_frames * (game.decision_snapshot - game.snapshots[0]) + (t.hold_78 || 0)) / game.fps;
}

function followHandoff() {
  if (!preload.inPlace || state.mode !== "showcase" || state.clip !== "past" || state.clipDone) return;
  const v = film(), next = preload.videos, end = pastEnd(v);
  if (!handoff.on) {                                  // half-way through the past's last frame: the future gets going
    if (!v.paused && v.currentTime >= end - 0.5 / game.fps) startHandoff();   // (so its own first frame is still on at the swap)
    return;
  }
  if ((v.ended || v.currentTime >= end - 0.005) && !next[0].paused && next[0].currentTime > 0) commitHandoff();
}

/** The future's copies start playing under the past (false when they cannot: then the past ends the usual way). Also
 *  from the past's end itself, for a slow computer whose frames missed the past's last one. */
function startHandoff() {
  if (handoff.on || !preload.inPlace || state.mode !== "showcase" || state.clip !== "past" || state.clipDone) return false;
  const next = preload.videos;
  if (!next.length || !next.every((x) => x.readyState >= 3)) return false;
  handoff.on = true;
  next.forEach((x) => x.play().catch(abortHandoff));
  handoff.timer = setTimeout(abortHandoff, 600);     // it never got going: the past ends as before, and the future loads then
  return true;
}

function commitHandoff() {
  clearTimeout(handoff.timer);
  handoff.on = false;
  preload.inPlace = false;
  const old = film(), oldStars = starsFilm(), [next, nextStars] = preload.videos.splice(0);
  old.removeAttribute("id");
  next.id = "film";
  next.classList.remove("film-next");
  next.removeAttribute("aria-hidden");
  const gone = [old];
  if (nextStars) {
    oldStars.removeAttribute("id");
    nextStars.id = "film-stars";
    nextStars.classList.remove("film-next");
    gone.push(oldStars);
  }
  gone.forEach((x) => { x.pause(); x.remove(); x.removeAttribute("src"); x.load(); });
  bindFilm(next);
  state.clip = "future";
  state.clipDone = false;
  setFilmState("ready");
  startFuture(true);
}

function abortHandoff() {
  if (!handoff.on) return;
  clearTimeout(handoff.timer);
  handoff.on = false;
  preload.inPlace = false;                          // once is enough: this film ends the usual way
  preload.videos.forEach((x) => x.pause());
  if (film().ended && state.clip === "past" && !state.clipDone) onEnded();
}

/** The film's own events (also for a film that took over from another). */
function bindFilm(v) {
  const mine = (fn) => (e) => { if (e.target === film()) fn(e); };
  v.addEventListener("ended", mine(onEnded));
  v.addEventListener("loadstart", mine(() => setFilmState("loading")));
  v.addEventListener("waiting", mine(() => { if ($("film-box").dataset.state !== "missing") setFilmState("loading"); }));
  v.addEventListener("playing", mine(() => setFilmState("ready")));
  v.addEventListener("canplay", mine(() => { if ($("film-box").dataset.state === "loading") setFilmState("ready"); }));
  v.addEventListener("error", mine(() => { if (film().getAttribute("src")) setFilmState("missing"); }));
}

/** Loading and missing states of the film (films are still being rendered for some galaxies). */
function setFilmState(name) {
  $("film-box").dataset.state = name;
  $("film-skip").hidden = name !== "missing";
  if (name === "loading") $("film-status-text").textContent = "Loading the film…";
  if (name === "missing") {
    $("film-status-text").textContent = "This film is not ready yet: it is still being rendered from the simulation. "
      + "The chart below shows the galaxy's real numbers, so you can still play.";
  }
}

function filmEnded() { return state.clipDone || $("film-box").dataset.state === "missing"; }

/** Where we are: between snapshots a and b, fraction u of the way; the chart cursor follows it. */
function position() {
  if (filmEnded()) {
    const s = state.clip === "past" ? game.decision_snapshot : game.snapshots[game.snapshots.length - 1];
    return { a: s, b: s, u: 0 };
  }
  return filmPosition(game, state.clip, film().currentTime || 0);
}

function fmtMass(m) {
  if (m >= 1e9) return `${(m / 1e9).toFixed(m >= 1e10 ? 0 : 1)} billion suns`;
  return `${Math.round(m / 1e6)} million suns`;
}
function fmtSfr(x) {
  if (x < 0.01) return "almost no new stars";
  return `${x < 1 ? x.toFixed(2) : x.toFixed(1)} new suns a year`;
}

/** Labels over the clean film: time, stars, star formation, all real values of the two saved moments,
 *  mixed with the same weight as the images (the blend), and a scale bar. */
function updateLabels(pos) {
  if (!isClean()) return;
  let lookback, logMass, sfr, blend;
  const L = state.galaxy.labels && state.galaxy.labels[state.clip];
  if (L && L.lookback_gyr.length) {
    // the film's own values, frame by frame (written by the render run)
    const last = L.lookback_gyr.length - 1;
    // the number of the frame on screen now (time × frames per second), kept inside the list
    const f =filmEnded() ? last : Math.min(last, Math.max(0, Math.floor((film().currentTime || 0) * game.fps)));
    lookback = L.lookback_gyr[f]; logMass = L.log_stellar_mass[f]; sfr = L.sfr[f]; blend = L.blend[f];
  } else {
    // the same rule from the series: linear in u, masses and SFR linear in log10, blend after the first quarter
    const s = state.galaxy.series, i = s.snap.indexOf(pos.a), j = s.snap.indexOf(pos.b), u = pos.u;
    const lg = (v) => Math.log10(Math.max(v, 1e-4));
    lookback = s.lookback[i] + u * (s.lookback[j] - s.lookback[i]);
    logMass = lg(s.mstar[i]) + u * (lg(s.mstar[j]) - lg(s.mstar[i]));
    sfr = 10 ** (lg(s.sfr[i]) + u * (lg(s.sfr[j]) - lg(s.sfr[i])));
    blend = pos.a === pos.b ? 0 : Math.max(0, (u - 0.25) / 0.75);
  }
  $("l-when").textContent = lookback.toFixed(2);
  // films of the "motion" style move each particle along an estimated path instead of blending two images
  $("l-blend").textContent = !(blend > 0) ? "" : state.galaxy.style === "motion"
    ? "estimated paths between two saved moments" : "blend of two saved moments";
  $("l-mass").textContent = `${fmtMass(10 ** logMass)} of stars`;
  $("l-sfr").textContent = fmtSfr(sfr);
}

function setScaleBar() {
  const widthKpc = state.galaxy.gas_view_kpc[0];
  // a round length that takes at least 12 % of the film's width (unless game.json gives one)
  const kpc =state.galaxy.scale_bar_kpc || [5, 10, 20, 25, 50, 100].find((k) => k / widthKpc >= 0.12) || 20;
  $("l-scalebar").style.width = `${(kpc / widthKpc) * 100}%`;
  const ly = Math.round((kpc * 3262) / 1000) * 1000;   // 1 kpc = 3,262 light years, rounded to the thousand
  $("l-scale").textContent = `${ly.toLocaleString("en")} light years`;
  $("l-scale").parentElement.style.width = "40%";
}

function updateTimeline() {
  const v = film();
  const u = filmEnded() ? 1 : v.duration ? v.currentTime / v.duration : 0;
  $("tl-past").style.width = `${(state.clip === "past" ? u : 1) * 100}%`;
  $("tl-future").style.width = `${(state.clip === "future" ? u : 0) * 100}%`;
}

function syncStars() {
  const v = film(), s = starsFilm();
  if (!isClean() || !s.src) return;
  // the stars film (the small box) follows the main film: if they drift more than 0.15 s apart, I put it back in step
  if (Math.abs(s.currentTime - v.currentTime) > 0.15) s.currentTime = v.currentTime;
  if (v.paused !== s.paused) (v.paused ? s.pause() : s.play().catch(() => {}));
}

function tick() {
  if (state.galaxy && document.body.dataset.screen === "film") {
    const pos = position();
    const chart = chartsFor(state.galaxy).find((c) => c.id === state.chart) || CHARTS[0];
    chart.draw($("chart"), game, state.galaxy, lookbackAt(state.galaxy.series, pos));
    updateLabels(pos);
    updateTimeline();
    checkSlow();
    syncStars();
    followHandoff();
  }
  requestAnimationFrame(tick);
}

function chartsFor(g) { return CHARTS.filter((c) => !c.only || (g && c.only(g))); }

function buildTabs() {
  const tabs = $("chart-tabs"), list = chartsFor(state.galaxy);
  if (!list.some((c) => c.id === state.chart)) state.chart = list[0].id;
  tabs.innerHTML = "";
  for (const c of list) {
    const b = document.createElement("button");
    b.className = "tab";
    b.setAttribute("role", "tab");
    b.textContent = c.label;
    b.setAttribute("aria-selected", String(c.id === state.chart));
    b.onclick = () => { state.chart = c.id; buildTabs(); };
    tabs.appendChild(b);
  }
}

/** The film opens out of the player's point in the sky, and closes back into it. */
function zoom(kind) {
  const stage = $("stage"), r = stage.getBoundingClientRect(), p = sky.playerScreen();
  stage.style.setProperty("--from-x", `${p.x - (r.left + r.width / 2)}px`);
  stage.style.setProperty("--from-y", `${p.y - (r.top + r.height / 2)}px`);
  stage.classList.remove("zoom-in", "zoom-out");
  void stage.offsetWidth;                         // I restart the CSS animation (it would not play twice otherwise)
  stage.classList.add(kind);
}

function startRound() {
  state.mode = "game";
  state.box = findBox();
  state.galaxy = pickGalaxy(state.box);
  buildTabs();                                    // the distance chart only for satellites
  state.guess = null;
  state.verdict = false;
  state.rewatch = false;
  sky.setPlayer({ x: state.galaxy.map_x ?? state.galaxy.log_mass, y: state.galaxy.map_y ?? state.galaxy.log_gas_fraction });
  const s = state.galaxy.series;
  $("past-text").textContent = `Its past, from ${lookbackOf(s.snap[0]).toFixed(1)} to ${lookbackOf(game.decision_snapshot).toFixed(1)} billion years ago: `
    + `${state.galaxy.is_central ? "the main galaxy of its group" : "a satellite of a bigger galaxy"}.`;
  endSuspense();
  $("thinking").hidden = true;
  setScaleBar();
  setPhase("past");
  go("film");
  zoom("zoom-in");
  playClip("past");
}

function onEnded() {
  if (handoff.on && state.clip === "past") return;   // the future is taking over (or gives up: abortHandoff ends it)
  if (state.clip === "past" && startHandoff()) return;   // a slow computer missed the last frame: it takes over now
  state.clipDone = true;
  if (state.mode === "showcase" || state.mode === "replay" || state.mode === "preview") {
    if (state.clip === "past" && straightThrough()) startFuture();
    else if (state.clip === "past") {                // no bet: a short pause at the moment of the bet, then the future
      const pause = {};
      state.midPause = pause;
      setTimeout(() => { if (state.midPause === pause) { state.midPause = null; startFuture(); } }, REDUCED ? 300 : MID_PAUSE_MS);
    } else finale();
    return;
  }
  if (state.clip === "past" && !state.guess && state.galaxy) {
    setPhase("bet");
    sealGauge();                                     // the model's gauge, beside your choice
    document.querySelector('[data-guess="off"]').focus({ preventScroll: true });
    keepInView(document.querySelector('.phase[data-phase="bet"]'));   // your choice in view on a short window
  }
  if (state.clip === "future" && state.rewatch) {
    setTimeout(backToSky, REDUCED ? 200 : 900);
  } else if (state.clip === "future") {
    finale();                                        // (usually started already, at the end of the film's motion)
  }
}

function makeGuess(guess) {
  if (!state.galaxy || state.guess) return;
  state.guess = guess;
  document.querySelectorAll(".your-bet").forEach((el) => {
    el.textContent = guess === "off" ? "it switches off" : "it keeps going";
    el.className = `your-bet ${guess}`;
  });
  setPhase("thinking");
  // suspense: the model "reads" its 17 inputs one after the other before its bet is ready (its answer stays sealed)
  $("veil").classList.add("on");
  $("thinking").hidden = false;
  const dots = $("thinking-dots");
  dots.innerHTML = MODEL_INPUTS.map(() => "<li></li>").join("");
  const items = [...dots.children];
  const total = REDUCED ? 1200 : THINK_MS, t0 = performance.now();
  let shown = -1;
  const think = (t) => {
    const u = Math.min(1, (t - t0) / total);
    const k = Math.min(MODEL_INPUTS.length - 1, Math.floor(u * MODEL_INPUTS.length));
    if (k !== shown) {
      shown = k;
      $("thinking-item").innerHTML = `<span>${MODEL_INPUTS[k]}</span>`;
      items.forEach((li, j) => li.classList.toggle("read", j <= k));
    }
    if (u < 1) requestAnimationFrame(think);
    else setTimeout(() => {
      $("veil").classList.remove("on");
      $("thinking").hidden = true;
      setPhase("ready");
      $("play-future").focus({ preventScroll: true });
      keepInView(document.querySelector('.phase[data-phase="ready"]'));
    }, THINK_HOLD_MS);
  };
  requestAnimationFrame(think);
}

// -----------------------------------------------------------------------------------------------------
// 4d. THE SUSPENSE OF THE FUTURE AND THE MODEL'S GAUGE
// -----------------------------------------------------------------------------------------------------
// The future film plays while the model's needle swings (staging, not data); near the end the film slows down,
// the needle lands on the model's real chance, a short black, then the verdict in large type (finale).

const betWords = (bet) => (bet === "off" ? "it switches off" : "it keeps going");
/** Seconds of the future film in motion (after them, the last moment is held). */
const motionEnd = () => (game.timeline.future_frames * (game.snapshots[game.snapshots.length - 1] - game.decision_snapshot)) / game.fps;

/** "Show the future" (or, for a remarkable galaxy, the end of its past): the future film; in a game, the needle of
 *  the model's gauge swings all along it. Its last moments are slowed down (the needle then stops on the model's real
 *  chance), then a short black and the verdict (see checkSlow, finale). */
function startFuture(handed = false) {
  const run = { cfg: suspenseCount >= 2 ? SUSPENSE.short : SUSPENSE.long, slowing: false, finale: false };
  if (!straightThrough()) suspenseCount += 1;      // only the films that slow down count (the shorter version comes from the third)
  state.sus = run;
  state.rewatch = false;
  $("model-say").textContent = "";
  if (!handed) playClip("future");                 // (handed: the future already plays, it took the past's place)
  if (state.mode === "game") swingNeedle(run);
  showFilmAndGauge();
}

// ---- the model's gauge

// a half dial: 0 % on the left, 100 % on the right; blue below the model's line ("keeps going"), red past it
const G = { cx: 100, cy: 100, r: 78 };
// a point of the dial for a chance p: the angle goes from π (left, 0 %) to 0 (right, 100 %)
const gaugePoint = (p, r = G.r) => { const a = Math.PI * (1 - p); return [G.cx + r * Math.cos(a), G.cy - r * Math.sin(a)]; };
const gauge = { raf: 0, v: 0.05, mode: "off", run: null };
const fmt1 = (n) => n.toFixed(1);

function drawGauge() {
  const th = game.threshold, [x0, y0] = gaugePoint(0), [xt, yt] = gaugePoint(th), [x1, y1] = gaugePoint(1);
  $("g-on").setAttribute("d", `M ${fmt1(x0)} ${fmt1(y0)} A ${G.r} ${G.r} 0 0 1 ${fmt1(xt)} ${fmt1(yt)}`);
  $("g-off").setAttribute("d", `M ${fmt1(xt)} ${fmt1(yt)} A ${G.r} ${G.r} 0 0 1 ${fmt1(x1)} ${fmt1(y1)}`);
  const [ax, ay] = gaugePoint(th, 66), [bx, by] = gaugePoint(th, 92), [lx, ly] = gaugePoint(th, 104);
  Object.entries({ x1: ax, y1: ay, x2: bx, y2: by }).forEach(([k, v]) => $("g-tick").setAttribute(k, fmt1(v)));
  $("g-th").setAttribute("x", fmt1(lx));
  $("g-th").setAttribute("y", fmt1(ly));
  $("g-th").textContent = `${Math.round(th * 100)} %`;
}

// the needle is drawn pointing straight up (50 %), so I turn it by (v - 0.5) × 180 degrees
function setNeedle(v) { $("g-needle").setAttribute("transform", `rotate(${((v - 0.5) * 180).toFixed(2)} 100 100)`); }

/** The value in the dial: "?" in the middle, or the model's chance on the side away from the needle. */
function setGaugeValue(text, p = null) {
  const value = $("g-value");
  value.setAttribute("x", p === null ? "100" : p < 0.5 ? "136" : "64");
  value.setAttribute("y", "82");
  value.textContent = text;
}

/** On a short window the film screen is taller than the window: bring a part of it into view (smoothly), never
 *  pushing its top out. */
function keepInView(top, bottom = top, pad = 12) {
  const h = window.innerHeight, a = top.getBoundingClientRect().top, b = bottom.getBoundingClientRect().bottom;
  let dy = 0;
  if (b > h - pad) dy = b - (h - pad);
  if (a - dy < pad) dy = a - pad;
  if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: REDUCED ? "auto" : "smooth" });
}

/** During the future: the film and the gauge in view; when both cannot fit, the film (the gauge comes into view
 *  when its needle lands, see checkSlow). */
function showFilmAndGauge() {
  const filmBox = $("film-box"), el = $("gauge");
  if (el.hidden || $("stage").classList.contains("gauge-side")) { keepInView(filmBox); return; }
  const fits = el.getBoundingClientRect().bottom - filmBox.getBoundingClientRect().top <= window.innerHeight - 24;
  keepInView(filmBox, fits ? el : filmBox);
}

/** Beside the film when the window leaves room for it, else under it. */
function placeGauge() {
  const stage = $("stage"), el = $("gauge");
  if (el.hidden) return;
  const free = (window.innerWidth - stage.offsetWidth) / 2, side = !NARROW.matches && free >= 260;
  stage.classList.toggle("gauge-side", side);
  if (side) {
    stage.style.setProperty("--gauge-w", `${Math.min(260, free - 60)}px`);
    stage.style.setProperty("--gauge-top", `${Math.max(0, ($("film-box").offsetHeight - el.offsetHeight) / 2)}px`);
  }
}

function stopNeedle() {
  cancelAnimationFrame(gauge.raf);
  gauge.mode = "off";
  gauge.run = null;
}

/** From your bet: the gauge with its line and what it means; the model's needle is not shown yet. */
function sealGauge() {
  stopNeedle();
  drawGauge();
  const el = $("gauge");
  el.hidden = false;
  el.classList.remove("live");
  $("g-on").classList.remove("lit");
  $("g-off").classList.remove("lit");
  setGaugeValue("?");
  $("g-say").innerHTML = `The model's chance it switches off. <b>Past the white line (${Math.round(game.threshold * 100)} %), it bets it switches off.</b>`;
  placeGauge();
}

/** During the future film the needle swings left and right, more or less fast, all along (staging, not data). */
function swingNeedle(run) {
  const el = $("gauge");
  if (el.hidden) sealGauge();
  stopNeedle();
  gauge.run = run;
  $("g-say").textContent = "The model's needle swings until the end of the film…";
  if (REDUCED) return;                                     // reduced motion: no swinging, the needle shows at the end
  el.classList.add("live");
  setGaugeValue("");
  const th = game.threshold, r = (lo, hi) => lo + Math.random() * (hi - lo);
  // mostly towards the other side of the line, so that it keeps crossing it
  const pick = (v) => (Math.random() < 0.7 ? (v < th ? r(th + 0.08, 0.95) : r(0.03, th - 0.06)) : r(0.03, 0.95));
  let from = gauge.v, to = pick(from), t0 = performance.now(), dur = r(900, 2000);
  gauge.mode = "swing";
  const step = (t) => {
    if (gauge.run !== run || gauge.mode !== "swing") return;
    const u = Math.min(1, (t - t0) / dur);
    gauge.v = from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * u));   // a cosine ease: slow at both ends
    setNeedle(gauge.v);
    if (u >= 1) { from = to; to = pick(from); t0 = t; dur = r(900, 2000); }
    gauge.raf = requestAnimationFrame(step);
  };
  gauge.raf = requestAnimationFrame(step);
}

/** In the slowed end: the needle brakes and stops on the model's real chance. */
function landNeedle(run, p, ms) {
  cancelAnimationFrame(gauge.raf);
  gauge.mode = "land";
  $("gauge").classList.add("live");
  const from = gauge.v, t0 = performance.now();
  const step = (t) => {
    if (gauge.run !== run) return;
    const u = ms > 0 ? Math.min(1, (t - t0) / ms) : 1;
    gauge.v = from + (p - from) * (1 - (1 - u) ** 3);      // a cubic ease-out: fast, then it brakes
    setNeedle(gauge.v);
    if (u < 1) gauge.raf = requestAnimationFrame(step);
    else showLanding(p);
  };
  gauge.raf = requestAnimationFrame(step);
}

/** Where the needle stopped: its zone lights up, and the model's bet is said. */
function showLanding(p) {
  cancelAnimationFrame(gauge.raf);
  gauge.mode = "landed";
  gauge.v = p;
  $("gauge").classList.add("live");
  setNeedle(p);
  const bet = p >= game.threshold ? "off" : "on";
  $(bet === "off" ? "g-off" : "g-on").classList.add("lit");
  setGaugeValue(percent(p), p);
  $("g-say").innerHTML = `The model bets <b class="bet-word ${bet}">${betWords(bet)}</b>.`;
  $("model-say").innerHTML = ` The model bets <b class="bet-word ${bet}">${betWords(bet)}</b> (${percent(p)}).`;
}

/** The last moments of the film slowed down, closer, the rest of the page in the dark; at the end, the finale. */
function checkSlow() {
  const run = state.sus;
  if (!run || run.finale || state.clip !== "future" || filmEnded()) return;
  const v = film(), end = motionEnd();
  if (!run.slowing && !straightThrough() && v.currentTime >= end - run.cfg.slowSpan && !v.paused) {
    run.slowing = true;
    if (!REDUCED) {
      v.playbackRate = starsFilm().playbackRate = run.cfg.slowRate;
      $("stage").classList.add("slowing");
    }
    document.body.classList.add("hush");
    // the model's needle brakes and stops on its real chance during the slowed end
    if (state.mode === "game") {
      // the slowed end lasts slowSpan / slowRate real seconds; the needle lands in 85 % of that time (× 1000 ms)
      landNeedle(run, state.galaxy.model_probability, REDUCED ? 0 : (run.cfg.slowSpan / run.cfg.slowRate) * 850);
      keepInView($("gauge"));                         // a very short window: now the gauge, to see where it lands
    }
  }
  if (v.currentTime >= end - 0.02) finale();
}

function resetSlow() {
  film().playbackRate = starsFilm().playbackRate = 1;
  $("stage").classList.remove("slowing");
  document.body.classList.remove("hush");
}

/** A short black, the verdict in large type, then the verdict screen (or the end of a remarkable galaxy's film),
 *  the black lifting with a wash of the verdict's colour. */
function finale() {
  const run = state.sus;
  if (state.verdict || (run && run.finale)) return;
  state.verdict = true;
  if (run) run.finale = true;
  film().pause();
  // the remarkable galaxies end straight on their end panel, with no black and no verdict in large type
  if (straightThrough()) { resetSlow(); showcaseEnd(); return; }
  if (state.mode === "game" && gauge.mode !== "landed") showLanding(state.galaxy.model_probability);   // (a film cut short)
  const cfg = run ? run.cfg : SUSPENSE.long, off = state.galaxy.quenched === 1;
  const fin = $("finale"), word = $("finale-word");
  word.textContent = off ? "It switched off." : "It kept making stars.";
  word.className = `finale-word ${off ? "off" : "on"}`;
  fin.style.setProperty("--wash", off ? "224, 69, 90" : "91, 143, 214");
  fin.classList.remove("on", "out", "word");
  fin.hidden = false;
  void fin.offsetWidth;
  fin.classList.add("on");
  const black = REDUCED ? 100 : cfg.black * 1000, hold = REDUCED ? 1000 : cfg.word * 1000;
  const token = {};                                  // leaving the film during the finale cancels what is left of it
  state.finale = token;
  setTimeout(() => { if (state.finale === token) fin.classList.add("word"); }, black);
  setTimeout(() => {
    if (state.finale !== token) return;
    resetSlow();
    if (state.mode === "game") revealTruth();
    else showcaseEnd();
    fin.classList.add("out");
    setTimeout(() => { if (state.finale === token) { hideFinale(); state.finale = null; } }, 950);
  }, black + hold);
}

function hideFinale() {
  const fin = $("finale");
  fin.hidden = true;
  fin.classList.remove("on", "out", "word");
}

/** Leaving the film, or a new round: no suspense left running. */
function endSuspense() {
  state.sus = null;
  state.finale = null;
  hideFinale();
  resetSlow();
  stopNeedle();
  state.midPause = null;
  $("gauge").hidden = true;
  $("stage").classList.remove("gauge-side");
  $("veil").classList.remove("on");
}

// -----------------------------------------------------------------------------------------------------
// 4e. THE VERDICT: the truth, the score, back to the sky
// -----------------------------------------------------------------------------------------------------
// What really happened, who was right (you and the model), the share of switch-offs in the galaxy's box, the
// score, and the sky coloured by the model's chance.

function bumpScore(id) {
  const el = $(id);
  el.classList.remove("bump");
  void el.offsetWidth;                                   // restart the animation
  el.classList.add("bump");
}

/** The picture on the "See it in 3D" button: the galaxy as its future film left it (the film's last frame),
 *  else a still of its past film or its poster. */
function fillSee3d() {
  const box = $("see3d-galaxy"), v = film(), size = 420;
  box.innerHTML = "";
  if (state.clip === "future" && isClean("future") && v.readyState >= 2 && v.videoWidth) {
    const c = document.createElement("canvas"), s = Math.min(v.videoWidth, v.videoHeight) * 0.62;   // the middle: the galaxy fills the circle
    c.width = c.height = size;
    c.getContext("2d").drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, size, size);
    box.appendChild(c);
  } else {
    box.appendChild(thumbOf({}, state.galaxy, size));
  }
}

function backToSky() {
  zoom("zoom-out");
  setTimeout(() => {
    film().pause();
    fillSee3d();
    go("verdict");
    sky.set({ kind: "chance", rings: $("map-truth").getAttribute("aria-pressed") === "true" });
  }, REDUCED ? 0 : 420);
}

function revealTruth() {
  const g = state.galaxy, box = state.box;
  const off = g.quenched === 1;
  const modelOff = g.model_probability >= game.threshold;
  const youRight = (state.guess === "off") === off, modelRight = modelOff === off;
  state.rounds += 1; state.you += youRight; state.model += modelRight;   // true adds 1, false adds 0
  rememberPlayed(box, g);
  document.querySelectorAll(".rounds").forEach((e) => (e.textContent = state.rounds));
  document.body.dataset.rounds = String(state.rounds);
  $("score-you").textContent = state.you;
  $("score-model").textContent = state.model;
  const truth = $("truth");
  truth.textContent = off ? "It switched off." : "It kept making stars.";
  truth.className = `truth ${off ? "off" : "on"}`;
  const say = (x) => (x ? '<span class="what off">it switches off</span>' : '<span class="what on">it keeps going</span>');
  const you = $("r-you"), model = $("r-model");
  you.className = youRight ? "right" : "wrong";
  you.innerHTML = `${youRight ? ICON_RIGHT : ICON_WRONG}<span>You bet ${say(state.guess === "off")}</span>`;
  model.className = modelRight ? "right" : "wrong";
  model.innerHTML = `${modelRight ? ICON_RIGHT : ICON_WRONG}<span>The model gave it <b>${percent(g.model_probability)}</b>, so it bet ${say(modelOff)}</span>`;
  if (box.n < 5) {          // a share of 1 or 2 galaxies would only ever read 0 % or 100 %
    $("r-box").textContent = `Only ${box.n} ${box.n === 1 ? "galaxy" : "galaxies"} of our sample ${box.n === 1 ? "has" : "have"} the same size, gas, black hole and neighbourhood: `
      + "far too few to say how often such galaxies switch off.";
  } else {
    $("r-box").textContent = `Of the ${box.n.toLocaleString("en")} galaxies like this one, ${box.n_quenched.toLocaleString("en")} switched off `
      + `within a billion years (${percent(box.quenched_share)}).` + (box.n < 20 ? " A small group, so this share is uncertain." : "");
  }
  backToSky();
  setTimeout(() => {
    if (youRight) bumpScore("score-you");
    if (modelRight) bumpScore("score-model");
  }, REDUCED ? 0 : 900);
}

// -----------------------------------------------------------------------------------------------------
// 4f. THE REMARKABLE GALAXIES (showcase), the home cards and the home map
// -----------------------------------------------------------------------------------------------------
// Three remarkable galaxies to watch without a bet: their cards on the home page, their intro screen (meet), and
// their film played straight through. Also the marks on the home map and "watch again" for a galaxy already met.

function showcaseItems() {
  return (game.showcase || []).filter((it) => it.ready === true && game.galaxies[String(it.id)]);
}

function openShowcase() {
  film().pause();
  endSuspense();
  state.mode = "showcase";
  const items = showcaseItems();
  const list = $("showcase-list");
  list.innerHTML = "";
  items.forEach((it, k) => {
    const li = document.createElement("li"), b = document.createElement("button");
    b.innerHTML = '<span class="title"></span><span class="story"></span>';
    b.querySelector(".title").textContent = it.title;
    b.querySelector(".story").textContent = it.story;
    b.onclick = () => openMeet(k, "list");
    b.onmouseenter = b.onfocus = () => sky.setMarks(marks(items), k);
    b.onmouseleave = b.onblur = () => sky.setMarks(marks(items));
    li.appendChild(b);
    list.appendChild(li);
  });
  sky.setPlayer(null);
  sky.set({ kind: "plain", dim: true });           // a quieter sky, so the three stand out
  sky.setMarks(marks(items));
  go("showcase");
}

/** A remarkable galaxy's card and its point on the home page's map, lit together (or put out). */
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
function lightCard(k, on) {
  if (document.body.dataset.screen !== "home" || !sky) return;
  const cards = $("home-cards-list").querySelectorAll("button.card"), card = cards[k];
  cards.forEach((c, j) => c.classList.toggle("lit", on && j === k));
  const all = homeMarks(), index = all.length - showcaseItems().length + k;   // the three come last
  const r = card && card.getBoundingClientRect();
  sky.setMarks(all, on ? index : -1, on && r ? { x: r.left + r.width / 2, y: r.top } : null);
}

/** The marks of the home page's map: the galaxies you have met (blue if they kept making stars, red if they switched
 *  off), then the remarkable galaxies with their names; and the count of the galaxies you have met. */
function homeMarks() {
  const showcase = new Set(showcaseItems().map((it) => String(it.id)));
  const mine = [...found].filter((id) => game.galaxies[id] && !showcase.has(id)).map((id) => {
    const g = game.galaxies[id];
    return { x: g.map_x ?? g.log_mass, y: g.map_y ?? g.log_gas_fraction, label: `Galaxy ${id}`, kind: g.quenched === 1 ? "off" : "on" };
  });
  const playable = new Set(game.boxes.flatMap((b) => (b.galaxies || []).map(String)));
  const met = [...found].filter((id) => playable.has(id)).length;
  $("found-count").innerHTML = `<b>${met}</b> / ${playable.size} galaxies discovered`;
  return [...mine, ...marks(showcaseItems())];
}

function marks(items) {
  return items.map((it) => {
    const g = game.galaxies[String(it.id)];
    return { x: g.map_x ?? g.log_mass, y: g.map_y ?? g.log_gas_fraction, label: it.title };
  });
}

/** Watch a galaxy already met, with no bet and no change to the score. */
function watchAgain() {
  const box = findBox(), g = box && game.galaxies[String(played.get(boxKey(box)))];
  if (!g) return;                                  // nothing met in this box (the button is hidden then)
  state.mode = "replay";
  state.box = box;
  state.galaxy = g;
  startFilm("Watching it again", "No bet this time: your score stays as it is.");
}

/** Why each remarkable galaxy is remarkable, by id: the line or two of its intro screen, as validated by the student.
 *  Every fact was checked against the simulation (TNG100-1, around snapshot 78, 3.5 billion years ago; the Milky Way:
 *  1.65 Suns of new stars a year, a halo of 1.3e12 Suns, a central black hole of 4.1e6 Suns). Names and stories come
 *  from game.json. */
const SHOWCASE_INTRO = {
  395850: "One of the fastest star makers in the whole simulation, and the fastest of its size. Every year it turns 49 Suns' "
    + "worth of gas into new stars, 30 times the Milky Way. In just 120 million years, its pace tripled.",
  269639: "One of the 7 fastest star makers in the whole simulation: 39 Suns a year. Then, in under a billion years, its star "
    + "making crashed more than a thousandfold. The likely culprit: a black hole 45 times heavier than the Milky Way's.",
  224668: "A small galaxy that dived deep into a group ten times heavier than the Milky Way's, at 2.5 million km/h. "
    + "The plunge swept away 95 % of its gas, which now trails behind it like jellyfish tentacles.",
};

/** A remarkable galaxy before its film: its picture, large, its name, why it is remarkable, and "Watch its life".
 *  Its point in the sky carries its name. */
function openMeet(k, from = "home") {
  const it = showcaseItems()[k];
  if (!it) return;
  const g = game.galaxies[String(it.id)];
  film().pause();
  endSuspense();
  Object.assign(state, { mode: "showcase", showcase: k, galaxy: g, meetFrom: from });
  // a large clean still if there is one (meet.jpg), else the card's picture
  const box = $("meet-figure"), img = box.querySelector("img") || box.appendChild(new Image());
  const still = media(g, it.meet || "meet.jpg"), card = thumbOf(it, g);
  img.onerror = () => { img.onerror = null; if (card.src) img.src = card.src; };
  img.src = still;
  img.alt = `${it.title}, rendered from the simulation`;
  $("meet-title").textContent = it.title;
  $("meet-intro").textContent = SHOWCASE_INTRO[it.id] || it.story;
  sky.setPlayer(null);
  sky.set({ kind: "plain" });
  sky.setMarks(marks([it]), 0);
  go("meet");
  $("meet-go").focus({ preventScroll: true });
}

/** Back from an intro screen to where it was opened, with the keyboard focus on the card or list entry that opened it. */
function leaveMeet() {
  const k = state.showcase;
  if (state.meetFrom === "list") {
    openShowcase();
    $("showcase-list").querySelectorAll("button")[k]?.focus({ preventScroll: true });
    return;
  }
  const card = $("home-cards-list").querySelectorAll("button.card")[k];   // the ready cards come first
  morph(() => {
    state.mode = "game";
    sky.setMarks([]);
    sky.set({ kind: "plain" });
    go("home");
    card?.focus({ preventScroll: true });
  }, card);
}

/** A remarkable galaxy's card opening into its intro screen, or closing back into it: its picture and its name travel
 *  between the card and the intro (where the title of the home page stands), while the rest crossfades (a view
 *  transition). Where the browser has none, or with reduced motion, the screens simply change. */
function morph(update, card) {
  if (!document.startViewTransition || REDUCED || !card) { update(); return; }
  const pic = card.querySelector(".thumb"), name = card.querySelector(".name");
  const mark = (on) => { pic.style.viewTransitionName = on ? "galaxy-pic" : ""; name.style.viewTransitionName = on ? "galaxy-name" : ""; };
  document.body.classList.add("morphing");
  const onHome = document.body.dataset.screen === "home";
  if (onHome) mark(true);                            // leaving the home page: the card is the old picture and name
  const t = document.startViewTransition(() => {
    if (onHome) mark(false);
    update();
    if (!onHome) mark(true);                         // back on the home page: the card is the new picture and name
    $(`screen-${document.body.dataset.screen}`)?.setAttribute("data-morphed", "");   // no second entrance on top
  });
  // a second click during the morph starts a new one and skips this one: its promises then reject, quietly
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(() => {});
  t.finished.catch(() => {}).finally(() => { mark(false); document.body.classList.remove("morphing"); });
}

function startShowcase(k) {
  const it = showcaseItems()[k];
  if (!it) return;                                   // no galaxy picked yet (its intro not open): nothing to play
  state.mode = "showcase";
  state.showcase = k;
  state.galaxy = game.galaxies[String(it.id)];
  startFilm(it.title, it.story);
}

/** Past then future, no bet (remarkable galaxies and galaxies met again). */
function startFilm(title, story) {
  state.box = null;
  state.guess = null;
  state.verdict = false;
  sky.setMarks([]);
  sky.setPlayer({ x: state.galaxy.map_x ?? state.galaxy.log_mass, y: state.galaxy.map_y ?? state.galaxy.log_gas_fraction });
  $("show-title").textContent = title;
  $("show-story").textContent = story;
  const replay = state.mode === "replay";
  $("show-leave").textContent = $("show-back").textContent = replay ? "Pick another galaxy"
    : state.mode === "preview" ? "Back" : showcaseItems().length > 1 ? "Back to the list" : "Back";
  buildTabs();
  endSuspense();
  $("thinking").hidden = true;
  setScaleBar();
  setPhase("show");
  go("film");
  zoom("zoom-in");
  playClip("past");
}

function showcaseEnd() {
  const g = state.galaxy, off = g.quenched === 1;
  const truth = $("show-truth");
  truth.textContent = off ? "It switched off." : "It kept making stars.";
  truth.className = `show-truth ${off ? "off" : "on"}`;
  $("show-model").textContent = `The model gave it a ${percent(g.model_probability)} chance of switching off.`;
  setPhase("show-end");
}

/** ?preview=sharp: the preview galaxies listed on the home page, each opening its film without a bet. */
function buildPreviewList() {
  const ids = (game.preview_ids || []).filter((id) => game.galaxies[String(id)]);
  if (!ids.length) return;
  const box = document.createElement("div");
  box.className = "preview-list";
  box.innerHTML = '<p class="home-cards-say">Sharp-style preview: watch these galaxies without a bet.</p><ol class="cards"></ol>';
  for (const id of ids) {
    const g = game.galaxies[String(id)], li = document.createElement("li"), card = document.createElement("button");
    card.className = "card";
    card.innerHTML = '<span class="thumb"></span><span><span class="name"></span><span class="cap"></span></span>';
    const b = game.boxes.find((x) => x.keeper === id || x.quencher === id);
    card.querySelector(".name").textContent = b ? `${b.size}, ${b.gas}` : `galaxy ${id}`;
    card.querySelector(".cap").textContent = b ? `${b.wind}, ${b.place === "alone" ? "alone" : "satellite"}` : (g.style || "");
    card.querySelector(".thumb").appendChild(thumbOf({ id }, g));
    card.onclick = () => {
      state.mode = "preview";
      state.galaxy = g;
      startFilm("Sharp-style preview", b ? `A ${b.size} galaxy with ${b.gas}, black hole ${b.wind}, ${b.place}.` : "");
    };
    li.appendChild(card);
    box.querySelector("ol").appendChild(li);
  }
  $("screen-home").appendChild(box);
  document.body.classList.add("is-preview");
}

/** The remarkable galaxies as small cards on the home page: the ready ones open their film, the
 *  others say "coming soon". */
function buildHomeCards() {
  const all = game.showcase || [], ready = showcaseItems();
  if (!all.length) return;
  const list = $("home-cards-list");
  list.innerHTML = "";
  // the ones you can watch come first (on a phone the row scrolls sideways)
  const ordered = [...all.filter((it) => ready.includes(it)), ...all.filter((it) => !ready.includes(it))];
  for (const it of ordered) {
    const li = document.createElement("li"), g = game.galaxies[String(it.id)], k = ready.indexOf(it);
    const card = document.createElement(k >= 0 ? "button" : "div");
    card.className = k >= 0 ? "card" : "card soon";
    card.innerHTML = '<span class="thumb"></span><span><span class="name"></span><span class="cap"></span></span>';
    card.querySelector(".name").textContent = it.title;
    // "no bet needed" is already said above the cards; only the ones not ready yet say so
    const cap = k >= 0 ? it.caption || "" : "coming soon";
    card.querySelector(".cap").textContent = cap;
    card.querySelector(".cap").hidden = !cap;
    if (k >= 0) {
      card.onclick = () => morph(() => openMeet(k, "home"), card);
      // on a computer, the card under the pointer (or the keyboard) lights its galaxy on the map, with a line to it
      card.addEventListener("mouseenter", () => { if (FINE.matches) lightCard(k, true); });
      card.addEventListener("mouseleave", () => lightCard(k, false));
      card.addEventListener("focus", () => { if (card.matches(":focus-visible")) lightCard(k, true); });
      card.addEventListener("blur", () => lightCard(k, false));
      // the same still as its intro screen (meet.jpg), so the card opens into the very picture it shows
      card.querySelector(".thumb").appendChild(thumbOf(it.meet ? { ...it, thumb: it.meet } : it, g));
    } else {
      card.setAttribute("aria-disabled", "true");
    }
    li.appendChild(card);
    list.appendChild(li);
  }
  $("home-cards").hidden = false;
}

/** A still of the galaxy: its thumbnail if there is one, else the bet moment of its clean film, else
 *  the centre of its poster (cropped to hide the printed labels). */
function thumbOf(it, g, size = 120) {
  if (it.thumb) {
    const img = new Image();
    img.alt = ""; img.loading = "lazy";
    const usual = `${MEDIA_BASE}${it.id}/${it.thumb}`;
    // a galaxy with its own media folder (?films=motion, ?preview=sharp) shows its own still, or the usual one
    if (g?.media_dir) img.addEventListener("error", () => { if (img.src !== new URL(usual, location.href).href) img.src = usual; }, { once: true });
    img.src = g?.media_dir ? media(g, it.thumb) : usual;
    return img;
  }
  if (g.films && g.films.includes("past_clean")) {
    // the frame is copied into a small square and the film let go at once: the card never keeps the film's
    // download open (the browser would make the same film wait when you then play it)
    const c = document.createElement("canvas"), v = document.createElement("video");
    c.width = c.height = size;
    c.setAttribute("aria-hidden", "true");
    Object.assign(v, { muted: true, playsInline: true, preload: "metadata" });
    const release = () => { v.onerror = v.onseeked = null; v.removeAttribute("src"); v.load(); };
    v.onloadedmetadata = () => { v.currentTime = Math.max(0, v.duration - 0.05); };
    v.onseeked = () => {
      const s = Math.min(v.videoWidth, v.videoHeight);
      c.getContext("2d").drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, c.width, c.height);
      release();
    };
    v.onerror = release;
    v.src = media(g, "past_clean.mp4");
    return c;
  }
  const img = new Image();
  img.alt = ""; img.className = "crop"; img.loading = "lazy";
  img.src = media(g, (g.posters && g.posters[1]) || "poster_0274.jpg");
  return img;
}

// -----------------------------------------------------------------------------------------------------
// 4g. FULL SCREEN
// -----------------------------------------------------------------------------------------------------
// Full screen for the film, the 3D view or the whole game. Where the browser cannot (iPhones), I make the
// element a fixed layer over the page instead ("pseudo full screen").

/** Full screen for the film and the 3D view. Where the browser cannot do it for an element (iPhones
 *  allow it only for videos), the element becomes a fixed layer over the whole page instead. */
function toggleFull(el) {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl === el) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  if (el.classList.contains("pseudo-full")) { setPseudo(el, false); return; }
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (request && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    const r = request.call(el);
    if (r && r.catch) r.catch(() => setPseudo(el, true));
  } else {
    setPseudo(el, true);
  }
}

/** The whole game full screen (the top bar's button), where the browser allows it for the page. The film's and the
 *  3D view's own full screen can open over it; leaving them comes back to the game full screen. */
const pageFull = { on: false };
function pageFullAvailable() {
  const d = document.documentElement;
  return Boolean((d.requestFullscreen || d.webkitRequestFullscreen) && (document.fullscreenEnabled || document.webkitFullscreenEnabled));
}
function togglePageFull() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  const d = document.documentElement, r = (d.requestFullscreen || d.webkitRequestFullscreen).call(d);
  if (r && r.catch) r.catch(() => {});
}

function setPseudo(el, on) {
  el.classList.toggle("pseudo-full", on);
  document.body.classList.toggle("locked", on);
  fullChanged();
}

function fullChanged() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  for (const [el, btn, what] of [[$("film-box"), $("fullscreen"), "the film"], [$("viewer"), $("viewer-fs"), "the 3D view"]]) {
    const on = fsEl === el || el.classList.contains("pseudo-full");
    el.classList.toggle("is-full", on);
    btn.setAttribute("aria-label", on ? "Leave full screen" : `Show ${what} full screen`);
  }
  const full3d = $("viewer").classList.contains("is-full");
  if (viewer && viewer.full !== full3d) viewer.setFull(full3d);   // the time bar then asks for the dense clouds
  // the game full screen: on with the page, off when nothing is full screen (a film over it keeps it on)
  if (fsEl === document.documentElement) pageFull.on = true;
  else if (!fsEl) pageFull.on = false;
  document.body.classList.toggle("page-full", pageFull.on);
  $("page-fs").setAttribute("aria-label", pageFull.on ? "Leave full screen" : "Show the game full screen");
  $("page-fs").title = pageFull.on ? "Leave full screen" : "Full screen";
}

// -----------------------------------------------------------------------------------------------------
// 4h. THE 3D VIEW AND ITS TIME BAR
// -----------------------------------------------------------------------------------------------------
// The time bar under the 3D view: it moves between the saved moments (snapshots), fades one cloud into the next,
// and shows the galaxy's numbers at that moment. The drawing itself is done by viewer3d.js.

const T3_SECONDS_PER_SNAPSHOT = 1.1;      // playing speed: one saved moment (about 160 million years) per 1.1 s
const t3 = { steps: [78, 84], full: [], s: 78, playing: false, dragging: false, settle: null, last: 0, galaxy: null };

/** A list of snapshot numbers from game.json ([72, ...] or [{snap: 72}, ...]), or null. */
function snapList(v) {
  if (!Array.isArray(v) || !v.length) return null;
  return [...new Set(v.map((x) => (typeof x === "object" ? x.snap : x)))].sort((a, b) => a - b);
}

function setupSteps(g) {
  const last = game.snapshots[game.snapshots.length - 1];
  t3.steps = snapList(g.cloud_steps) || [game.decision_snapshot, last];
  t3.full = g.cloud_full ? snapList(g.cloud_full_steps) || [game.decision_snapshot, last] : [];
  const scrub = $("t3-scrub");
  scrub.min = t3.steps[0];
  scrub.max = t3.steps[t3.steps.length - 1];
  t3.s = t3.steps.includes(game.decision_snapshot) ? game.decision_snapshot : t3.steps[0];
  t3.playing = false; t3.settle = null; t3.galaxy = g.id;
  const everyStep = t3.steps.every((sn, i) => i === 0 || sn - t3.steps[i - 1] === 1);
  $("made-3d").textContent = everyStep
    ? "Its time bar steps through the moments the simulation really saved, about 160 million years apart. Between two of them the two clouds fade into each other; no particle is moved or invented."
    : "For this galaxy the 3D view has two saved moments so far: the moment of your bet and a billion years later. Its time bar jumps from one to the other, with no blend; no particle is moved or invented.";
  $("t3-play").setAttribute("aria-pressed", "false");
}

/** The cloud of one snapshot: the dense copy in full screen when it exists, else the light one. */
function cloudOf(snap) {
  const g = state.galaxy, scale = g.cloud_scale_kpc, i = g.series.snap.indexOf(snap);
  const masses = i >= 0 ? { mstar: g.series.mstar[i], mgas: g.series.mgas[i] } : null;
  const dense = media(g, `cloud_full_${snap}.bin`), light = media(g, `cloud_${snap}.bin`);
  if (viewer.full && t3.full.includes(snap) && !viewer.failed.has(dense)) {
    const f = viewer.get(dense, scale, masses);
    if (f) return { frame: f, dense: true };
    const fallback = viewer.get(light, scale, masses);    // show the light copy while the dense one loads
    return { frame: fallback, dense: false, loadingDense: true };
  }
  return { frame: viewer.get(light, scale, masses), dense: false, failed: viewer.failed.has(light) };
}

/** Where position s falls: between saved moments a and b, with the films' rule for the crossfade
 *  (the first quarter shows moment a alone, then a smooth fade to b). */
function where(s) {
  const st = t3.steps;
  for (let k = 0; k < st.length - 1; k++) {
    if (s < st[k + 1]) {
      const a = st[k], b = st[k + 1], u = Math.max(0, (s - a) / (b - a));
      // two moments that are not next to each other (only 78 and 84 exist): a plain cut, no fade
      if (b - a > 1) return { a, b, w: u >= 0.5 ? 1 : 0, cut: true };
      const x = Math.min(1, Math.max(0, (u - 0.25) / 0.75));
      return { a, b, w: x * x * (3 - 2 * x) };            // "smoothstep": a fade that starts and ends gently
    }
  }
  return { a: st[st.length - 1], b: null, w: 0 };
}

function lookbackAtSnap(s) {
  const ser = state.galaxy.series, i = Math.max(0, ser.snap.indexOf(Math.floor(s))), j = Math.min(ser.snap.length - 1, i + 1);
  return ser.lookback[i] + (s - Math.floor(s)) * (ser.lookback[j] - ser.lookback[i]);
}

function render3d() {
  const pos = where(t3.s);
  const A = cloudOf(pos.a), B = pos.b !== null && pos.w > 0 ? cloudOf(pos.b) : null;
  if (A.frame && (!B || B.frame)) viewer.display(A.frame, B ? B.frame : null, pos.w);
  else if (A.frame) viewer.display(A.frame, null, 0);        // the next moment is still loading: hold this one
  // warm up the next saved moment so that playing never waits long
  const next = t3.steps[t3.steps.indexOf(pos.b === null ? pos.a : pos.b) + 1];
  if (next !== undefined) cloudOf(next);

  const shownSnap = pos.w >= 1 ? pos.b : pos.a;
  const at = pos.cut ? shownSnap : t3.s;                   // across a cut, time and cursor jump with the cloud
  const lb = lookbackAtSnap(at);
  $("t3-when").textContent = lb.toFixed(2);
  $("t3-note").textContent = pos.w > 0 && pos.w < 1 ? "blend of two saved moments"
    : shownSnap === game.decision_snapshot ? "the moment of your bet"
      : shownSnap === game.snapshots[game.snapshots.length - 1] ? "a billion years after your bet" : "a saved moment";
  const scrub = $("t3-scrub");
  if (!t3.dragging) scrub.value = String(t3.s);
  scrub.setAttribute("aria-valuetext", `${lb.toFixed(2)} billion years ago`);
  drawTimeCurve($("t3-curve"), game, state.galaxy, t3.steps[0], t3.steps[t3.steps.length - 1], at, t3.steps);
  showNow(at);

  const status = $("viewer-status"), detail = $("viewer-detail");
  if (A.failed) { status.hidden = false; status.textContent = "The 3D file of this moment could not be loaded."; }
  else status.hidden = true;
  if (A.frame) {
    const n = A.frame.counts.gas + A.frame.counts.stars;
    detail.textContent = A.loadingDense ? "loading full detail…" : `${n.toLocaleString("en")} particles${A.dense ? ", full detail" : ""}`;
  } else if (!A.failed) detail.textContent = "loading…";
}

/** The galaxy's numbers at the moment shown in 3D (between two saved moments: in proportion, like the time bar). */
let nowShown = "";
function showNow(s) {
  const ser = state.galaxy.series, i = Math.max(0, ser.snap.indexOf(Math.floor(s))), j = Math.min(ser.snap.length - 1, i + 1);
  const u = s - Math.floor(s);
  const at = (k) => (Array.isArray(ser[k]) && ser[k][i] !== null && ser[k][j] !== null ? ser[k][i] + u * (ser[k][j] - ser[k][i]) : null);
  const fmt = (x) => (x === null || !Number.isFinite(x) ? "–" : x <= 0 ? "0" : x < 0.01 ? "< 0.01" : x < 10 ? x.toFixed(2) : x.toFixed(1));
  const stars = at("mstar"), gas = at("mgas");
  const text = [fmt(stars === null ? null : stars / 1e9), fmt(gas === null ? null : gas / 1e9), fmt(at("sfr"))];
  if (text.join("|") === nowShown) return;
  nowShown = text.join("|");
  [$("r3-stars").textContent, $("r3-gas").textContent, $("r3-sfr").textContent] = text;
}

/** The colour key beside the 3D view shows only the colours on screen. */
function syncKey() {
  const on = (l) => document.querySelector(`#layers [data-layer="${l}"]`).getAttribute("aria-pressed") === "true";
  $("key3d").dataset.stars = on("stars") ? "on" : "off";
  $("key3d").dataset.gas = !on("gas") ? "off" : on("bySf") ? "sf" : "plain";
}

function setPlaying(on) {
  const again = on && t3.s >= t3.steps[t3.steps.length - 1] - 1e-6;
  if (again) t3.s = t3.steps[0];                                     // from the end, start again
  // while time moves, the exposure is held from the start of playback: a galaxy that fades looks dimmer
  if (on) viewer?.holdExposure(again);
  t3.playing = on;
  t3.settle = null;
  $("t3-play").setAttribute("aria-pressed", String(on));
  $("t3-play").setAttribute("aria-label", on ? "Pause" : "Play the galaxy through time");
}

/** Glide to the nearest saved moment (after a drag, or with the arrow keys). */
function settleTo(snap) { t3.settle = snap; }

function nearestStep(s) {
  return t3.steps.reduce((best, sn) => (Math.abs(sn - s) < Math.abs(best - s) ? sn : best), t3.steps[0]);
}

function tick3d(t) {
  if (document.body.dataset.screen === "3d" && viewer && state.galaxy && t3.galaxy === state.galaxy.id) {
    // seconds since the last frame, at most 0.1 (after a hidden tab, time does not jump ahead)
    const dt = t3.last ? Math.min(0.1, (t - t3.last) / 1000) : 0;
    t3.last = t;
    const end = t3.steps[t3.steps.length - 1];
    if (t3.playing) {
      const pos = where(t3.s);
      const ready = cloudOf(pos.a).frame && (pos.b === null || cloudOf(pos.b).frame);
      if (ready) t3.s = Math.min(end, t3.s + (REDUCED ? 4 : 1) * dt / T3_SECONDS_PER_SNAPSHOT);
      if (t3.s >= end) setPlaying(false);
    } else if (t3.settle !== null) {
      const d = t3.settle - t3.s;
      t3.s = Math.abs(d) < 0.004 || REDUCED ? t3.settle : t3.s + d * Math.min(1, dt * 7);
      if (t3.s === t3.settle) t3.settle = null;
    }
    render3d();
  } else {
    t3.last = 0;
  }
  requestAnimationFrame(tick3d);
}

async function open3d() {
  go("3d");
  if (!viewer) {
    const { GalaxyViewer } = await import("./viewer3d.js");
    viewer = new GalaxyViewer($("viewer"), $("viewer").querySelector(".viewer-bar"));
    requestAnimationFrame(tick3d);
  }
  if (t3.galaxy !== state.galaxy.id) {
    viewer.clear();                     // the camera frames the new galaxy and glides in once its first cloud is ready
    setupSteps(state.galaxy);
    nowShown = "";
  } else {
    viewer.replay();                    // the same galaxy again: the same opening glide
  }
}

function wire3d() {
  const scrub = $("t3-scrub");
  $("t3-play").onclick = () => setPlaying(!t3.playing);
  scrub.addEventListener("input", () => { t3.dragging = true; setPlaying(false); viewer?.holdExposure(); t3.s = +scrub.value; });
  scrub.addEventListener("change", () => { t3.dragging = false; settleTo(nearestStep(t3.s)); });
  scrub.addEventListener("pointerup", () => { if (t3.dragging) { t3.dragging = false; settleTo(nearestStep(t3.s)); } });
  scrub.addEventListener("keydown", (e) => {
    const i = t3.steps.indexOf(nearestStep(t3.settle ?? t3.s));
    const to = { ArrowLeft: i - 1, ArrowDown: i - 1, ArrowRight: i + 1, ArrowUp: i + 1, Home: 0, End: t3.steps.length - 1, PageDown: i - 1, PageUp: i + 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setPlaying(false);
    viewer?.holdExposure();
    settleTo(t3.steps[Math.max(0, Math.min(t3.steps.length - 1, to))]);
  });
  document.querySelectorAll("#layers .toggle").forEach((b) => (b.onclick = () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    viewer?.set(b.dataset.layer, on);
    syncKey();
  }));
}

// -----------------------------------------------------------------------------------------------------
// 4i. THE OPENING: one real galaxy shrinks into its point of light
// -----------------------------------------------------------------------------------------------------
// Once per visit: the hero galaxy's picture, large, pulls back until it lands on its own point in the sky.
// Any click or key skips it. Also the "How this was made" lines about the hero and the motion films.

const INTRO_KEY = "will-it-switch-off:intro-seen";

/** "How this was made" for the films of the "motion" style (data/game_motion.json): they are not blends, and
 *  their gas changes colour. Hidden when no galaxy has such a film. */
function describeMotionFilms() {
  const ids = (game.motion_ids || []).map(String).filter((id) => game.galaxies[id]?.style === "motion");
  if (!ids.length) return;
  // in the order of the cards on the home page, then any other
  const order = (game.showcase || []).map((it) => String(it.id));
  ids.sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
  const titles = ids.map((id) => (game.showcase || []).find((it) => String(it.id) === id)?.title || `galaxy ${id}`);
  const names = titles.length > 1 ? `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}` : titles[0];
  $("made-motion").querySelector("span").textContent = `The films of ${names} are made differently. Between two saved `
    + "moments the images are not blended: each gas cell and star goes from one moment to the next by turning steadily "
    + "about the galaxy's centre, while its distance from the centre and its height change evenly; new stars and gas "
    + "cells that merge or split fade in or out in place. So the positions in between are estimates (the label says "
    + "\"estimated paths\"). Their gas is drawn icy blue while the galaxy makes stars and turns amber as it switches "
    + "off, following its real star formation per year: blue above 2 × 10⁻¹¹ (10⁻¹⁰·⁷), amber below the "
    + "switched-off line at 10⁻¹¹, mixed in between.";
  $("made-motion").hidden = false;
  $("made-except").textContent = ", except in the new films below,";
}

/** The hero galaxy: game.json "hero" ({id, image} in media/<id>/), or, until it exists, the first galaxy
 *  with a stars film, shown at the moment of the bet. */
function heroOf() {
  const h = game.hero;
  if (h && h.image && Number.isFinite(h.map_x ?? game.galaxies[String(h.id)]?.map_x)) {
    const g = game.galaxies[String(h.id)];
    // on screen, plain words; the technical caption (bands, dust) stays in "How this was made"
    const then = agoAt(h.snapshot);
    const caption = `Galaxy ${h.id} in the light of its own stars${then !== null ? `, ${then.toFixed(1)} billion years ago` : ""}.`
      + " Rendered from IllustrisTNG TNG100-1 data.";
    return { url: `${MEDIA_BASE}${h.id}/${h.image}`, pos: { x: h.map_x ?? g.map_x, y: h.map_y ?? g.map_y }, caption };
  }
  const g = Object.values(game.galaxies).find((x) => x.films && x.films.includes("past_stars"));
  return g ? { video: media(g, "past_stars.mp4"), pos: { x: g.map_x ?? g.log_mass, y: g.map_y ?? g.log_gas_fraction } } : null;
}

/** "How this was made": what the opening picture shows, and that its point in the sky is an earlier moment. */
function describeHero() {
  const h = game.hero;
  if (!h || !h.image) return;
  // the picture's moment and the bet's moment (the moment of every point of the sky)
  const then = agoAt(h.snapshot), bet = agoAt(78);
  const when = then !== null ? `as it looked ${then.toFixed(1)} billion years ago` : `at snapshot ${h.snapshot}`;
  const point = bet !== null && then !== null && Math.abs(bet - then) > 0.05
    ? ` Its point in the sky is where it was ${bet.toFixed(1)} billion years ago, at the moment of the bet, like every point.`
    : "";
  $("made-hero").querySelector("span").textContent = `The first image is galaxy ${h.id} ${when}.${point} ${h.caption || ""}`.trim();
  $("made-hero").hidden = false;
}

/** Wait for the hero picture (or the placeholder frame) to be ready, at most a few seconds. */
function heroElement(hero) {
  return new Promise((resolve) => {
    const done = (el) => { clearTimeout(timer); resolve(el); };
    const timer = setTimeout(() => resolve(null), 3500);
    if (hero.url) {
      const img = new Image();
      img.alt = "";
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = hero.url;
    } else {
      const v = document.createElement("video");
      Object.assign(v, { muted: true, playsInline: true, preload: "auto" });
      v.onloadedmetadata = () => { v.currentTime = Math.max(0, v.duration - 0.05); };
      v.onseeked = () => done(v);
      v.onerror = () => done(null);
      v.src = hero.video;
    }
  });
}

/** Keyframes of the dezoom: fade in, hold, then a pull-back whose size shrinks evenly on a log scale
 *  (so it reads as a steady camera move) with a soft landing, then the picture hands over to the dot. */
function dezoomFrames(start, end, endScale) {
  const at = (x, y, s, o, offset) => ({ transform: `translate(${x}px, ${y}px) scale(${s})`, opacity: o, offset });
  const frames = [at(start.x, start.y, 1.06, 0, 0), at(start.x, start.y, 1, 1, 0.18)];
  const n = 28, a = 0.26, b = 0.9;
  for (let k = 0; k <= n; k++) {
    // a gentle start and a long, soft landing (ease in-out, weighted towards the end)
    const t = k / n, e = (1 - Math.cos(Math.PI * t ** 0.8)) / 2;
    const s = Math.exp(e * Math.log(endScale));          // from 1 to endScale, evenly on a log scale
    frames.push(at(start.x + e * (end.x - start.x), start.y + e * (end.y - start.y), s, 1, a + t * (b - a)));
  }
  frames.push(at(end.x, end.y, endScale, 0, 1));
  return frames;
}

/** One real galaxy in starlight shrinks into its own point of light, while the sky appears around it.
 *  Once per visit; any click, tap or key skips it; with reduced motion the sky simply fades in. */
async function playIntro() {
  let seen = false;
  try { seen = sessionStorage.getItem(INTRO_KEY) === "1"; sessionStorage.setItem(INTRO_KEY, "1"); } catch (error) { /* no storage */ }
  const hero = heroOf(), body = document.body;
  if (seen || REDUCED || !hero) { body.classList.remove("intro-on"); return; }
  const intro = $("intro"), box = $("intro-galaxy");
  let anims = [], ended = false;
  const width0 = window.innerWidth;
  // a phone turned (or a window resized) during the opening: the landing point has moved, so skip to the end
  function turned() { if (window.innerWidth !== width0) finish(); }
  function finish() {
    if (ended) return;
    ended = true;
    anims.forEach((a) => a.cancel());
    intro.hidden = true;
    box.innerHTML = "";
    $("intro-caption").hidden = true;
    body.classList.remove("intro-on");
    body.classList.add("intro-done");
    window.removeEventListener("keydown", finish);
    window.removeEventListener("resize", turned);
    fitSky();
    // the hero's point keeps a short pulse, so the eye knows where it landed (only if you are still on the home page)
    if (body.dataset.screen !== "home") return;
    sky.setPlayer(hero.pos);
    setTimeout(() => { if (sky.player === hero.pos) sky.setPlayer(null); }, 3200);
  }
  // a click, tap or key skips the opening at any moment, also while the picture is still on its way
  body.classList.add("intro-on");
  intro.hidden = false;
  intro.onclick = finish;
  window.addEventListener("keydown", finish);
  window.addEventListener("resize", turned);
  // the landing point depends on the sky's place, which on a phone depends on the height of the text below
  // it: wait for the fonts too (at most a moment), so the galaxy lands where its point really is
  const fontsIn = document.fonts ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]) : null;
  const [el] = await Promise.all([heroElement(hero), fontsIn]);
  if (ended) return;
  if (!el) { finish(); return; }
  fitSky();
  box.appendChild(el);
  // what the picture is, in small type while it is large (the same words are in "How this was made")
  if (hero.caption) { $("intro-caption").textContent = hero.caption; $("intro-caption").hidden = false; }
  const size = Math.min(window.innerWidth, window.innerHeight) * 0.82;
  box.style.setProperty("--size", `${size}px`);
  const start = { x: window.innerWidth / 2 - size / 2, y: window.innerHeight / 2 - size / 2 };
  const land = sky.toScreen(hero.pos);
  const endScale = 16 / size;                       // a soft point of light, the size of a glowing galaxy dot
  const end = { x: land.x - size / 2, y: land.y - size / 2 };
  anims = [
    box.animate(dezoomFrames(start, end, endScale), { duration: 6400, fill: "forwards" }),
    $("sky").animate([{ opacity: 0 }, { opacity: 0, offset: 0.34 }, { opacity: 1, offset: 0.85 }, { opacity: 1 }], { duration: 6400, fill: "forwards" }),
  ];
  setTimeout(finish, 6400 * 0.82);              // the page arrives as the galaxy lands on its point
}

// =====================================================================================================
// 5. SOUND
// =====================================================================================================
// Nothing here either: sound.js plays the music and the small sounds. It reads <body data-screen>, data-mode and
// data-galaxy (set by go() in 4a) and window.gameScore (set in init below) to know what to play and when.

// =====================================================================================================
// 6. WIRING: loading the data and connecting every button
// =====================================================================================================
// init() runs once when the page opens: I load game.json and map.json, build the sky, start the opening, and
// connect each button of index.html to its function above. If the data cannot load, a plain message is shown.

async function init() {
  // 1. I load the two data files (a trial version of game.json when the address asks for one)
  const gameFile = PREVIEW ? "data/game_preview.json" : MOTION ? "data/game_motion.json" : "data/game.json";
  const loadGame = () => fetch(gameFile).then((r) => { if (!r.ok) throw new Error(`no ${gameFile}`); return r.json(); })
    .catch((error) => { if (!MOTION) throw error; return fetch("data/game.json").then((r) => r.json()); });
  const [g, m] = await Promise.all([loadGame(), fetch("data/map.json").then((r) => r.json())]);
  game = g; mapData = m;
  // for the music of the remarkable galaxies (sound.js): each galaxy's real numbers and the films' clock
  window.gameScore = { series: (id) => game.galaxies[String(id)]?.series || null, timeline: game.timeline, fps: game.fps,
    offLine: game.quenched_ssfr || 1e-11, first: game.snapshots[0], decision: game.decision_snapshot };
  // 2. I build the sky of points and the texts that depend on the data, then start the opening
  sky = new Sky($("sky"), mapData);
  edges = mapData.edges || { size: tertiles(sky.x), gas: tertiles(sky.y) };
  $("made-threshold").textContent = `${Math.round(game.threshold * 100)} %`;   // the % never wraps alone
  describeMotionFilms();
  describeHero();
  $("go-choose").disabled = false;
  playIntro();

  // 3. I connect each button of index.html to what it does (home, questions, film, bet, verdict, 3D, showcase)
  $("go-choose").onclick = openChoose;
  $("home-link").onclick = () => { film().pause(); endSuspense(); state.mode = "game"; sky.setPlayer(null); sky.setMarks([]); sky.set({ kind: "plain" }); go("home"); };
  document.querySelectorAll(".question").forEach((qEl) => {
    qEl.querySelectorAll(".option").forEach((b) => {
      b.setAttribute("aria-pressed", "false");
      b.onclick = () => answer(qEl.dataset.key, b.dataset.value, b);
    });
  });
  $("go-past").onclick = startRound;
  $("replay-past").onclick = $("replay-past-2").onclick = () => playClip("past");
  document.querySelectorAll("[data-guess]").forEach((b) => (b.onclick = () => makeGuess(b.dataset.guess)));
  $("play-future").onclick = () => {
    setPhase("future");
    startFuture();
  };
  bindFilm(film());
  $("film-skip").onclick = () => { if (!state.clipDone) onEnded(); };
  $("fullscreen").onclick = () => toggleFull($("film-box"));
  $("viewer-fs").onclick = () => toggleFull($("viewer"));
  $("page-fs").hidden = !pageFullAvailable();
  $("page-fs").onclick = togglePageFull;
  document.addEventListener("fullscreenchange", fullChanged);
  document.addEventListener("webkitfullscreenchange", fullChanged);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".pseudo-full").forEach((el) => setPseudo(el, false));
  });
  $("again").onclick = $("again-3d").onclick = () => { film().pause(); sky.setPlayer(null); openChoose(); };
  $("rewatch").onclick = () => {
    endSuspense();                                   // watching again: the two bets are known, no slowed end
    state.rewatch = true;
    setPhase("future");
    go("film");
    zoom("zoom-in");
    sealGauge();
    showLanding(state.galaxy.model_probability);     // the model's needle already where it stopped
    playClip("future");
  };
  $("map-truth").onclick = () => {
    const on = $("map-truth").getAttribute("aria-pressed") !== "true";
    $("map-truth").setAttribute("aria-pressed", String(on));
    sky.set({ kind: "chance", rings: on });
  };
  $("go-3d").onclick = open3d;
  $("back-film").onclick = () => go(state.mode === "game" ? "verdict" : "film");
  const nShow = showcaseItems().length;
  if (nShow) {
    const words = { 1: "a remarkable galaxy", 2: "two remarkable galaxies", 3: "three remarkable galaxies" }[nShow] || `${nShow} remarkable galaxies`;
    $("go-showcase-2").textContent = `Curious? Meet ${words}`;
    $("showcase-title").textContent = words[0].toUpperCase() + words.slice(1);
    $("go-showcase-2").hidden = false;
  }
  buildHomeCards();
  sky.setMarks(homeMarks());                       // the first home page: the three remarkable galaxies, and any met before
  // and the other way round: a remarkable galaxy under the pointer on the map lights its card; a click opens it
  let litFromMap = -1;
  $("sky").addEventListener("mousemove", (e) => {
    if (document.body.dataset.screen !== "home" || !FINE.matches) return;
    const m = sky.markAt(e.clientX, e.clientY), k = m < 0 ? -1 : m - (sky.marks.length - showcaseItems().length);
    if (k === litFromMap) return;
    if (litFromMap >= 0) lightCard(litFromMap, false);
    litFromMap = k;
    if (k >= 0) lightCard(k, true);
    $("sky").style.cursor = k >= 0 ? "pointer" : "";
  });
  $("sky").addEventListener("mouseleave", () => { if (litFromMap >= 0) lightCard(litFromMap, false); litFromMap = -1; $("sky").style.cursor = ""; });
  $("sky").addEventListener("click", () => {
    if (document.body.dataset.screen === "home" && litFromMap >= 0) $("home-cards-list").querySelectorAll("button.card")[litFromMap]?.click();
  });
  if (PREVIEW) buildPreviewList();
  $("go-showcase-2").onclick = openShowcase;
  $("meet-go").onclick = () => startShowcase(state.showcase);
  $("meet-back").onclick = leaveMeet;
  $("showcase-back").onclick = () => { sky.setMarks([]); sky.set({ kind: "plain" }); go("home"); };
  $("show-leave").onclick = $("show-back").onclick = () => {
    if (state.mode === "replay") openChoose();
    else if (state.mode === "preview") { film().pause(); endSuspense(); sky.setPlayer(null); sky.set({ kind: "plain" }); state.mode = "game"; go("home"); }
    else openShowcase();
  };
  $("met-other").onclick = () => { clearAnswer(KEYS[KEYS.length - 1]); updateChoice(); showQuestion(KEYS.length - 1); };
  $("met-again").onclick = watchAgain;
  $("show-again").onclick = () => { endSuspense(); state.verdict = false; setPhase("show"); playClip("past"); };
  $("show-3d").onclick = open3d;
  $("viewer").addEventListener("dblclick", (e) => { if (e.target.tagName === "CANVAS") toggleFull($("viewer")); });
  wire3d();
  $("made-link").onclick = () => $("made").showModal();
  // 4. I start the film's frame loop (tick) and keep the layout right when the window changes size
  buildTabs();
  requestAnimationFrame(tick);
  window.addEventListener("resize", fitSky);
  window.addEventListener("resize", placeGauge);
  document.fonts?.ready.then(fitSky);
  fitSky();
}

init().catch((error) => {
  // the game data could not be loaded: show the page with a plain message instead of a blank screen
  document.body.classList.remove("intro-on");
  $("intro").hidden = true;
  const p = document.createElement("p");
  p.className = "note";
  p.setAttribute("role", "alert");
  p.textContent = "The game could not load its data. Please check your connection and reload the page.";
  $("screen-home").appendChild(p);
  console.error(error);
});
