// Live charts drawn under the films. All values are the real per-snapshot values of the
// galaxy (TNG100 catalogue and black-hole particles), joined by straight lines.

// Block map
//   0. SETTINGS             the energy unit and the colours of every chart
//   2. DATA PROCESSING
//      2a. film time -> cosmic time   filmPosition, lookbackAt
//      2b. axis ranges and ticks      range, ticks
//   4. INTERFACE AND ANIMATIONS
//      4a. small drawing kit   canvas setup, axes frame, lines, dots, legend, colour mix
//      4b. the charts          drawSsfr, drawMasses, drawEnergy, drawGauge, drawTimeCurve, drawFuel,
//                              drawDistance (plus percent and hasHostDistance, small helpers the page uses)
// (This file has no 1. DATA, 3. RENDERING or 5. SOUND block: the data comes in from game.js.)

// =====================================================================
// 0. SETTINGS
// =====================================================================
// The fixed numbers and colours the charts share. COLOURS is exported so
// the page can use the very same colours for its own text and buttons.

// I turn the simulation's energy unit into erg with this one factor
const CODE_ENERGY_TO_ERG = 2.94e53; // (1e10 Msun/h)(ckpc/h)^2/(0.978 Gyr/h)^2, h = 0.6774, comoving factor ignored

export const COLOURS = {
  quenched: "#e0455a", forming: "#5b8fd6", stars: "#f2c46d", gas: "#c86bd8",
  kinetic: "#e0455a", thermal: "#f2a65a", satellite: "#f2a65a", grid: "rgba(238,241,255,0.07)", axis: "rgba(255,255,255,0.45)",
  text: "rgba(238,241,255,0.75)", faint: "rgba(238,241,255,0.5)", cursor: "#ffffff",
};

// =====================================================================
// 2. DATA PROCESSING: film time -> cosmic time, axis ranges and ticks
// =====================================================================
// The films run in frames; the data runs in snapshots of the simulation.
// Here I turn a moment of the film into "between snapshot a and b" and into
// billions of years ago, and I work out the log ranges and ticks of the axes.

// ---- 2a. film time -> cosmic time

/** Position in the film (clip, seconds) -> {a, b, u}: between snapshot a and b, fraction u of the way. */
export function filmPosition(game, clip, seconds) {
  const t = game.timeline, fps = game.fps, d = game.decision_snapshot, first = game.snapshots[0];
  let f = Math.max(0, Math.floor(seconds * fps));            // the frame number of the film
  if (clip === "past") {
    // the past film first holds on the first snapshot for a moment
    if (f < t.hold_start) return { a: first, b: first, u: 0 };
    f -= t.hold_start;
    const k = Math.floor(f / t.past_frames);                  // each snapshot step lasts past_frames frames
    if (first + k >= d) return { a: d, b: d, u: 0 };         // I stop at the decision snapshot
    return { a: first + k, b: first + k + 1, u: (f % t.past_frames) / t.past_frames };
  }
  // the future film starts at the decision snapshot and runs to the last one
  const last = game.snapshots[game.snapshots.length - 1];
  const k = Math.floor(f / t.future_frames);
  if (d + k >= last) return { a: last, b: last, u: 0 };
  return { a: d + k, b: d + k + 1, u: (f % t.future_frames) / t.future_frames };
}

/** Lookback time (Gyr) of a film position, for one galaxy's series. */
export function lookbackAt(series, pos) {
  const i = series.snap.indexOf(pos.a), j = series.snap.indexOf(pos.b);
  // a straight line between the two snapshots' lookback times
  return series.lookback[i] + pos.u * (series.lookback[j] - series.lookback[i]);
}

// ---- 2b. axis ranges and ticks (in powers of ten)

/** The range of powers of ten that holds all positive values, with some room (pad) on each side. */
function range(values, pad = 0.3) {
  const logs = values.filter((v) => v > 0).map(Math.log10);   // I skip zeros: they have no logarithm
  return [Math.floor(Math.min(...logs) - pad), Math.ceil(Math.max(...logs) + pad)];
}

/** Whole powers of ten from lo to hi, at most about maxTicks of them. */
function ticks([lo, hi], maxTicks = 6) {
  const step = Math.max(1, Math.ceil((hi - lo) / maxTicks));   // I skip powers when there are too many
  const out = [];
  for (let p = lo; p <= hi; p += step) out.push(p);
  return out;
}

// =====================================================================
// 4. INTERFACE AND ANIMATIONS: the live charts
// =====================================================================
// Each chart is redrawn on every frame of the film, up to the cursor (the
// moment the film shows). First a small kit of drawing helpers, then the
// charts themselves, each one a function the page calls with a canvas.

// ---- 4a. small drawing kit

/** Size the canvas for a sharp picture on any screen and give back a clean 2D context. */
function setup(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  // I resize the canvas only when its size really changed (resizing clears it and costs time)
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);        // so I can draw in CSS pixels
  ctx.clearRect(0, 0, w, h);
  ctx.font = "12px Figtree, 'Segoe UI', system-ui, sans-serif";
  return { ctx, w, h };
}

/** The axes of a log chart: grid lines, tick labels, axis titles. Gives back the box and the x, y scales. */
function frame(ctx, w, h, series, yRange, yTicks, yLabel) {
  const box = { l: 58, r: w - 14, t: 14, b: h - 34 };   // room on the left and bottom for the labels
  const [t0, t1] = [Math.max(...series.lookback), Math.min(...series.lookback)];
  // x: the oldest moment on the left, today on the right
  const x = (lb) => box.l + ((t0 - lb) / (t0 - t1)) * (box.r - box.l);
  // y: on a log scale, so 10, 100 and 1000 are equally spaced
  const y = (v) => box.b - ((Math.log10(v) - yRange[0]) / (yRange[1] - yRange[0])) * (box.b - box.t);
  ctx.strokeStyle = COLOURS.grid;
  ctx.fillStyle = COLOURS.faint;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const p of yTicks) {
    const yy = y(10 ** p);
    ctx.beginPath(); ctx.moveTo(box.l, yy); ctx.lineTo(box.r, yy); ctx.stroke();
    ctx.fillText(`10${superscript(p)}`, box.l - 6, yy);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // a time label every half billion years
  for (let lb = Math.ceil(t1 * 2) / 2; lb <= t0 + 1e-9; lb += 0.5) {
    ctx.fillText(lb.toFixed(1), x(lb), box.b + 6);
  }
  ctx.fillStyle = COLOURS.text;
  ctx.fillText("billion years ago", (box.l + box.r) / 2, box.b + 20);
  // I turn the canvas a quarter turn to write the y title upwards
  ctx.save();
  ctx.translate(12, (box.t + box.b) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "middle";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
  return { box, x, y };
}

/** A power written as superscript digits, for the "10⁻¹¹" labels. */
function superscript(p) {
  const map = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵",
    6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  return String(p).split("").map((c) => map[c] ?? c).join("");
}

/** Draw one series up to the cursor (lookback), with a dot at the cursor. */
function line(ctx, axes, series, values, cursor, colour, floor) {
  // I lift values under the floor up to it (a zero cannot be drawn on a log scale)
  const pts = series.lookback.map((lb, i) => [lb, Math.max(values[i], floor)]);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  let started = false, last = null;
  for (let i = 0; i < pts.length; i++) {
    const [lb, v] = pts[i];
    if (lb < cursor - 1e-9) {                           // this point is after the cursor: the film is not there yet
      if (i > 0 && last) {                              // partial last segment up to the cursor
        const [lb0, v0] = last;
        const u = (lb0 - cursor) / (lb0 - lb);          // how far the cursor is along this segment
        // I blend in log space, so the partial segment stays on the straight line of the log chart
        const vc = 10 ** (Math.log10(v0) + u * (Math.log10(v) - Math.log10(v0)));
        ctx.lineTo(axes.x(cursor), axes.y(vc));
        ctx.stroke();
        dot(ctx, axes.x(cursor), axes.y(vc), colour);
      }
      return;
    }
    const X = axes.x(lb), Y = axes.y(v);
    if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
    last = pts[i];
  }
  ctx.stroke();
  if (last) dot(ctx, axes.x(last[0]), axes.y(last[1]), colour);
}

/** A round dot of radius 4 px: the head of a line at the cursor. */
function dot(ctx, x, y, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill();
}

/** The dashed upright line at the moment of the player's bet (the decision snapshot). */
function decisionLine(ctx, axes, series, decision) {
  const lb = series.lookback[series.snap.indexOf(decision)];   // I find the bet's time in the series
  const X = axes.x(lb);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(X, axes.box.t); ctx.lineTo(X, axes.box.b); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLOURS.faint;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("your bet", X + 5, axes.box.b - 4);
}

/** A legend in the top right corner: a small colour bar and a name per line. */
function legend(ctx, w, items) {
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  let x = w - 18;
  // I write from right to left, so I take the items in reverse order
  for (const [label, colour] of items.slice().reverse()) {
    ctx.fillStyle = COLOURS.text;
    ctx.fillText(label, x, 24);
    const tw = ctx.measureText(label).width;           // the width of the name, to put its colour bar before it
    ctx.fillStyle = colour;
    ctx.fillRect(x - tw - 18, 21, 12, 6);
    x -= tw + 34;
  }
}

/** A colour t of the way from hex colour a to hex colour b, with transparency alpha. */
function mix(a, b, t, alpha) {
  // I read the red, green and blue pairs of hex digits of "#rrggbb"
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + t * (pb[i] - v)));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

// ---- 4b. the charts

/** A. Specific star formation rate with the quenching line. */
export function drawSsfr(canvas, game, galaxy, cursor) {
  const { ctx, w, h } = setup(canvas);
  const s = galaxy.series, floor = 1e-13;
  // from 10^-13 up to at least 10^-9 per year
  const yr = [-13, Math.max(-9, range(s.ssfr)[1])];
  const axes = frame(ctx, w, h, s, yr, ticks(yr, h < 180 ? 3 : 6), "star formation per year");   // fewer ticks on a short chart
  const q = axes.y(game.quenched_ssfr);                  // the height of the "switched off" line
  // a faint crimson band under the line
  ctx.fillStyle = "rgba(224,69,90,0.10)";
  ctx.fillRect(axes.box.l, q, axes.box.r - axes.box.l, axes.box.b - q);
  ctx.strokeStyle = COLOURS.quenched;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(axes.box.l, q); ctx.lineTo(axes.box.r, q); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLOURS.quenched;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText("switched off (below 10⁻¹¹ per year)", axes.box.l + 6, q + 4);
  decisionLine(ctx, axes, s, game.decision_snapshot);
  // the same line, steel blue above the 'switched off' line and crimson below it
  // (I draw it twice, each time clipped to one side of the line)
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, q); ctx.clip();
  line(ctx, axes, s, s.ssfr, cursor, COLOURS.forming, floor);
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.rect(0, q, w, h - q); ctx.clip();
  line(ctx, axes, s, s.ssfr, cursor, COLOURS.quenched, floor);
  ctx.restore();
}

/** B. Gas mass and stellar mass. */
export function drawMasses(canvas, game, galaxy, cursor) {
  const { ctx, w, h } = setup(canvas);
  const s = galaxy.series;
  const yr = range(s.mstar.concat(s.mgas), 0.2);         // one range that holds both masses
  const axes = frame(ctx, w, h, s, yr, ticks(yr, h < 180 ? 3 : 6), "mass (suns)");
  decisionLine(ctx, axes, s, game.decision_snapshot);
  line(ctx, axes, s, s.mgas, cursor, COLOURS.gas, 1e6);
  line(ctx, axes, s, s.mstar, cursor, COLOURS.stars, 1e6);
  legend(ctx, w, [["gas", COLOURS.gas], ["stars", COLOURS.stars]]);
}

/** D. Energy released by the black hole, wind (kinetic) and heating (thermal) modes, cumulative. */
export function drawEnergy(canvas, game, galaxy, cursor) {
  const { ctx, w, h } = setup(canvas);
  const s = galaxy.series;
  const kin = s.e_kinetic.map((v) => v * CODE_ENERGY_TO_ERG), th = s.e_thermal.map((v) => v * CODE_ENERGY_TO_ERG);
  const all = kin.concat(th).filter((v) => v > 0);
  const yr = all.length ? range(all, 0.3) : [55, 60];     // a default range when the black hole released nothing
  const axes = frame(ctx, w, h, s, yr, ticks(yr), "energy released (erg)");
  decisionLine(ctx, axes, s, game.decision_snapshot);
  const floor = 10 ** yr[0];                              // zeros sit on the bottom of the chart
  line(ctx, axes, s, th, cursor, COLOURS.thermal, floor);
  // I draw the wind line only if the wind mode ever switched on
  if (kin.some((v) => v > 0)) line(ctx, axes, s, kin, cursor, COLOURS.kinetic, floor);
  legend(ctx, w, [["heating mode", COLOURS.thermal], ["wind mode", COLOURS.kinetic]]);
  if (!kin.some((v) => v > 0)) {
    ctx.fillStyle = COLOURS.faint; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("the wind mode never switches on for this galaxy", (axes.box.l + axes.box.r) / 2, (axes.box.t + axes.box.b) / 2);
  }
}

/** C. The model's chance of quenching as a gauge, next to the player's guess. */
export function drawGauge(canvas, game, galaxy, state) {
  const { ctx, w, h } = setup(canvas);
  const cx = w * 0.36, cy = h * 0.82, r = Math.min(w * 0.3, h * 0.68);   // the centre and radius of the half circle
  ctx.lineWidth = 18;
  ctx.lineCap = "butt";
  const steps = 60;                                    // I draw the arc in 60 small pieces, each a little redder
  for (let i = 0; i < steps; i++) {                    // background arc, blue -> red
    // angles from PI (left, 0 %) to 2 PI (right, 100 %): the upper half circle
    const a0 = Math.PI + (i / steps) * Math.PI, a1 = Math.PI + ((i + 1) / steps) * Math.PI;
    const t = i / (steps - 1);
    ctx.strokeStyle = mix(COLOURS.forming, COLOURS.quenched, t, 0.35);
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1 + 0.002); ctx.stroke();   // a tiny overlap hides the seams
  }
  const th = Math.PI + game.threshold * Math.PI;      // the model says "switches off" above its threshold
  ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx + (r - 14) * Math.cos(th), cy + (r - 14) * Math.sin(th));
  ctx.lineTo(cx + (r + 14) * Math.cos(th), cy + (r + 14) * Math.sin(th)); ctx.stroke();
  ctx.fillStyle = COLOURS.faint; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("model's line", cx + (r + 26) * Math.cos(th), cy + (r + 26) * Math.sin(th));
  ctx.textBaseline = "top";
  ctx.fillText("0 %", cx - r, cy + 14); ctx.fillText("100 %", cx + r, cy + 14);

  // once revealed, the needle sweeps up to the model's chance as progress goes from 0 to 1
  const shown = state.revealed ? galaxy.model_probability * state.progress : null;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  if (shown === null) {
    ctx.fillStyle = COLOURS.text; ctx.font = "600 34px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("?", cx, cy - 8);
    ctx.font = "12px Figtree, 'Segoe UI', system-ui, sans-serif"; ctx.fillStyle = COLOURS.faint;
    ctx.fillText("hidden until you guess", cx, cy + 32);
  } else {
    const a = Math.PI + shown * Math.PI;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (r - 6) * Math.cos(a), cy + (r - 6) * Math.sin(a)); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 2 * Math.PI); ctx.fill();
    ctx.font = "600 30px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`${percent(shown)}`, cx, cy - r * 0.35);
    ctx.font = "12px Figtree, 'Segoe UI', system-ui, sans-serif"; ctx.fillStyle = COLOURS.faint;
    ctx.fillText("model's chance of switching off", cx, cy + 32);
  }
  // the player's guess, on the right
  const gx = w * 0.78;
  ctx.textAlign = "center"; ctx.fillStyle = COLOURS.faint; ctx.font = "12px Figtree, 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("your guess", gx, h * 0.3);
  ctx.font = "600 18px 'Segoe UI', system-ui, sans-serif";
  if (state.guess) {
    ctx.fillStyle = state.guess === "off" ? COLOURS.quenched : COLOURS.forming;
    ctx.fillText(state.guess === "off" ? "switches off" : "keeps forming", gx, h * 0.3 + 26);
  } else {
    ctx.fillStyle = COLOURS.text; ctx.fillText("not yet", gx, h * 0.3 + 26);
  }
}

/** A chance written for people: "0 %", "< 1 %" or a whole percent. */
export function percent(p) {
  if (p === 0) return "0 %";
  if (p < 0.01) return "< 1 %";
  return `${Math.round(p * 100)} %`;
}

/** The small star-formation curve under the 3D time bar. x is in snapshot numbers (s0 to s1), with
 *  the same inset as the slider's thumb so the two line up; the cursor is the snapshot shown. */
export function drawTimeCurve(canvas, game, galaxy, s0, s1, cursor, steps, inset = 8) {
  const { ctx, w, h } = setup(canvas);
  const s = galaxy.series, floor = 1e-13;
  // the log range: from 10^-13 up to at least 10^-9 (1e-12 keeps Math.max safe when every value is zero)
  const lo = -13, hi = Math.max(-9, Math.ceil(Math.log10(Math.max(...s.ssfr.filter((v) => v > 0), 1e-12)) + 0.2));
  // x by snapshot number ("|| 1" avoids a division by zero when s0 = s1)
  const X = (snap) => inset + ((snap - s0) / (s1 - s0 || 1)) * (w - 2 * inset);
  const Y = (v) => h - 4 - ((Math.log10(Math.max(v, floor)) - lo) / (hi - lo)) * (h - 10);
  const q = Y(game.quenched_ssfr);
  ctx.fillStyle = "rgba(224,69,90,0.10)";
  ctx.fillRect(inset, q, w - 2 * inset, h - q);
  ctx.strokeStyle = "rgba(224,69,90,0.7)"; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(inset, q); ctx.lineTo(w - inset, q); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = "11px Figtree, 'Segoe UI', sans-serif"; ctx.fillStyle = "rgba(224,69,90,0.9)";
  ctx.textAlign = "right"; ctx.textBaseline = "top";
  ctx.fillText("switched off", w - inset - 2, q + 2);
  const bet = game.decision_snapshot;
  if (bet >= s0 && bet <= s1) {                          // I mark the bet only if it lies inside the bar's range
    ctx.strokeStyle = "rgba(238,241,255,0.3)"; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(X(bet), 2); ctx.lineTo(X(bet), h - 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(238,241,255,0.55)"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("your bet", X(bet) + 4, 1);
  }
  // the curve, steel blue above the switched-off line and crimson below it
  const pts = s.snap.map((sn, i) => [sn, s.ssfr[i]]).filter(([sn]) => sn >= s0 && sn <= s1);
  for (const [clipTop, clipH, colour] of [[0, q, COLOURS.forming], [q, h - q, COLOURS.quenched]]) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, clipTop, w, clipH); ctx.clip();
    ctx.strokeStyle = colour; ctx.lineWidth = 1.8; ctx.beginPath();
    pts.forEach(([sn, v], i) => (i ? ctx.lineTo(X(sn), Y(v)) : ctx.moveTo(X(sn), Y(v))));
    ctx.stroke(); ctx.restore();
  }
  // the moments that exist in 3D, and the one shown
  ctx.fillStyle = "rgba(238,241,255,0.45)";
  for (const sn of steps) { ctx.beginPath(); ctx.arc(X(sn), h - 2, 1.6, 0, 2 * Math.PI); ctx.fill(); }
  const cx = X(cursor);
  ctx.strokeStyle = "rgba(238,241,255,0.85)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  // the dot on the curve at the cursor: i and j are the snapshots on each side of it
  const i = Math.max(0, s.snap.findIndex((sn) => sn > cursor) - 1), j = Math.min(s.snap.length - 1, i + 1);
  const u = s.snap[j] === s.snap[i] ? 0 : (cursor - s.snap[i]) / (s.snap[j] - s.snap[i]);
  // I blend the two values in log space, like the curve itself
  const lv = Math.log10(Math.max(s.ssfr[i], floor)) + u * (Math.log10(Math.max(s.ssfr[j], floor)) - Math.log10(Math.max(s.ssfr[i], floor)));
  const cy = Y(10 ** lv);
  ctx.fillStyle = cy > q ? COLOURS.quenched : COLOURS.forming;   // under the line (lower on screen): crimson
  ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI); ctx.fill();
}

/** B. Fuel left: the galaxy's star-forming gas (all its gas until the catalogue value is in the data)
 *  as a share of what it had at the first snapshot, on a plain linear scale. The moment the galaxy
 *  switches off is marked in crimson once the film reaches it. */
export function drawFuel(canvas, game, galaxy, cursor) {
  const { ctx, w, h } = setup(canvas);
  // star-forming gas when the data has it and the galaxy starts with some; otherwise all its gas
  const s = galaxy.series, useSf = Boolean(s.mgas_sf && s.mgas_sf[0] > 0), gas = useSf ? s.mgas_sf : s.mgas;
  const base = gas[0] > 0 ? gas[0] : Math.max(...gas, 1);   // 100 % = the gas at the first snapshot
  const pct = gas.map((v) => (100 * v) / base);
  // the top of the chart: a round 50 %, at least 100 % and at most 400 %
  const top = Math.min(400, Math.max(100, Math.ceil(Math.max(...pct) / 50) * 50));
  // the same box and time axis as frame(), but with a plain linear y axis
  const box = { l: 58, r: w - 14, t: 14, b: h - 34 };
  const [t0, t1] = [Math.max(...s.lookback), Math.min(...s.lookback)];
  const x = (lb) => box.l + ((t0 - lb) / (t0 - t1)) * (box.r - box.l);
  const y = (v) => box.b - (v / top) * (box.b - box.t);
  ctx.lineWidth = 1;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const step = top <= 200 ? 50 : 100;
  for (let v = 0; v <= top + 1e-9; v += step) {
    // the 100 % line (the starting amount) is a little brighter than the others
    ctx.strokeStyle = v === 100 ? "rgba(238,241,255,0.22)" : COLOURS.grid;
    ctx.beginPath(); ctx.moveTo(box.l, y(v)); ctx.lineTo(box.r, y(v)); ctx.stroke();
    // on a short chart I label only every 100 %
    if (v % 100 === 0 || h > 180) { ctx.fillStyle = COLOURS.faint; ctx.fillText(`${v} %`, box.l - 6, y(v)); }
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = COLOURS.faint;
  for (let lb = Math.ceil(t1 * 2) / 2; lb <= t0 + 1e-9; lb += 0.5) ctx.fillText(lb.toFixed(1), x(lb), box.b + 6);
  ctx.fillStyle = COLOURS.text;
  ctx.fillText("billion years ago", (box.l + box.r) / 2, box.b + 20);
  ctx.save(); ctx.translate(12, (box.t + box.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "middle";
  ctx.fillText(useSf ? "star-forming gas left" : "gas left", 0, 0); ctx.restore();
  decisionLine(ctx, { box, x }, s, game.decision_snapshot);   // decisionLine needs only the box and x

  // the moment it switches off for good: the start of the last stretch under the line, if it lasts to
  // the end (a galaxy that dips under and comes back has not switched off; one under the line from the
  // first snapshot gets no mark, there is no moment to show)
  let off = -1;                                          // -1 means: no switch-off moment
  if (s.ssfr[s.ssfr.length - 1] < game.quenched_ssfr) {  // only if it ends under the line
    off = s.ssfr.length - 1;
    // I walk back from the end while the galaxy stays under the line
    while (off > 0 && s.ssfr[off - 1] < game.quenched_ssfr) off--;
    if (off === 0) off = -1;
  }
  const offX = off >= 0 && cursor <= s.lookback[off] + 1e-9 ? x(s.lookback[off]) : null;   // only once the film is there

  // the line, up to the cursor; after the switch-off moment it turns crimson
  const pts = [];
  for (let i = 0; i < pct.length; i++) {
    // points the film has reached
    if (s.lookback[i] >= cursor - 1e-9) { pts.push([x(s.lookback[i]), y(pct[i])]); continue; }
    if (i > 0) {
      // then one last point at the cursor, part of the way to the next snapshot (linear here)
      const u = (s.lookback[i - 1] - cursor) / (s.lookback[i - 1] - s.lookback[i]);
      pts.push([x(cursor), y(pct[i - 1] + u * (pct[i] - pct[i - 1]))]);
    }
    break;
  }
  // two clipped passes: purple left of the switch-off moment, crimson right of it
  // (with no moment, offX is null and "?? w" makes the crimson part empty)
  for (const [from, to, colour] of [[0, offX ?? w, COLOURS.gas], [offX ?? w, w, COLOURS.quenched]]) {
    if (to <= from) continue;
    ctx.save(); ctx.beginPath(); ctx.rect(from, 0, to - from, h); ctx.clip();
    ctx.strokeStyle = colour; ctx.lineWidth = 2.2; ctx.beginPath();
    pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke(); ctx.restore();
  }
  if (pts.length) {
    const [px, py] = pts[pts.length - 1];
    dot(ctx, px, py, offX !== null && px > offX ? COLOURS.quenched : COLOURS.gas);
  }
  if (offX !== null) {
    ctx.strokeStyle = COLOURS.quenched; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(offX, box.t); ctx.lineTo(offX, box.b); ctx.stroke(); ctx.setLineDash([]);
    // near the right edge I write the label on the left of the line, so it stays inside the chart
    ctx.fillStyle = COLOURS.quenched; ctx.textAlign = offX > box.r - 90 ? "right" : "left"; ctx.textBaseline = "top";
    ctx.fillText("switched off", offX + (offX > box.r - 90 ? -6 : 6), box.t);
  }
}

/** True when the galaxy is a satellite at some snapshot and its distance to the big galaxy is in the data. */
export function hasHostDistance(galaxy) {
  const d = galaxy.series.host_dist_r200;
  // a central galaxy has only empty values here (null), so no distance chart
  return Array.isArray(d) && d.some((v) => v !== null && v !== undefined);
}

/** C. Satellites only: distance to the central galaxy of its group, in units of the group's radius
 *  (R200c; 1 = the edge of the group), so the dive into the big galaxy's hot gas can be seen. */
export function drawDistance(canvas, game, galaxy, cursor) {
  const { ctx, w, h } = setup(canvas);
  const s = galaxy.series, d = s.host_dist_r200;
  const vals = d.filter((v) => v !== null && v !== undefined);
  // the top: 10 % above the largest distance, rounded up to a half, and at least 1.5
  const top = Math.max(1.5, Math.ceil(Math.max(...vals) * 1.1 * 2) / 2);
  const box = { l: 58, r: w - 14, t: 14, b: h - 34 };
  const [t0, t1] = [Math.max(...s.lookback), Math.min(...s.lookback)];
  const x = (lb) => box.l + ((t0 - lb) / (t0 - t1)) * (box.r - box.l);
  const y = (v) => box.b - (v / top) * (box.b - box.t);
  ctx.lineWidth = 1;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const step = top <= 2 ? 0.5 : 1;
  for (let v = 0; v <= top + 1e-9; v += step) {
    ctx.strokeStyle = COLOURS.grid;
    ctx.beginPath(); ctx.moveTo(box.l, y(v)); ctx.lineTo(box.r, y(v)); ctx.stroke();
    ctx.fillStyle = COLOURS.faint; ctx.fillText(String(v), box.l - 6, y(v));
  }
  // the edge of the group
  ctx.strokeStyle = "rgba(238,241,255,0.45)"; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(box.l, y(1)); ctx.lineTo(box.r, y(1)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = COLOURS.text; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
  ctx.fillText("edge of the group", box.r - 4, y(1) - 3);
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = COLOURS.faint;
  for (let lb = Math.ceil(t1 * 2) / 2; lb <= t0 + 1e-9; lb += 0.5) ctx.fillText(lb.toFixed(1), x(lb), box.b + 6);
  ctx.fillStyle = COLOURS.text;
  ctx.fillText("billion years ago", (box.l + box.r) / 2, box.b + 20);
  ctx.save(); ctx.translate(12, (box.t + box.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "middle";
  ctx.fillText("distance to the big galaxy", 0, 0); ctx.restore();
  decisionLine(ctx, { box, x }, s, game.decision_snapshot);
  // the path, only where the galaxy is a satellite, up to the cursor
  ctx.strokeStyle = COLOURS.satellite; ctx.lineWidth = 2.2;
  let last = null;
  ctx.beginPath();
  for (let i = 0; i < d.length; i++) {
    const v = d[i], lb = s.lookback[i];
    if (lb < cursor - 1e-9) {                            // past the cursor: I finish with a piece up to it, then stop
      if (last && v !== null && v !== undefined && i > 0) {
        const u = (s.lookback[i - 1] - cursor) / (s.lookback[i - 1] - lb);
        const vc = d[i - 1] + u * (v - d[i - 1]);
        ctx.lineTo(x(cursor), y(vc));
        last = [x(cursor), y(vc)];
      }
      break;
    }
    if (v === null || v === undefined) { last = null; continue; }   // not a satellite here: a gap in the line
    if (last) ctx.lineTo(x(lb), y(v)); else ctx.moveTo(x(lb), y(v));   // after a gap I start a new piece
    last = [x(lb), y(v)];
  }
  ctx.stroke();
  if (last) dot(ctx, last[0], last[1], COLOURS.satellite);
}
