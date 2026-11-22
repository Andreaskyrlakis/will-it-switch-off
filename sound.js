// Background music: off at start (browsers block autoplay), one click starts it with a fade-in, another click fades
// it out. Each part of the game has its own track, chosen from what the page shows (body data-screen, data-mode and
// data-galaxy, set by game.js): the home and the list of remarkable galaxies, choosing a galaxy, watching the film
// (with its verdict and 3D view), and a "boss" track of its own for each remarkable galaxy (its intro, film and 3D
// view). When the part changes, the tracks crossfade. Each track loops on its own. A small slider next to the button sets the
// volume. The on/off choice and the volume are remembered; the music dips a little during the verdict.
//
// BLOCK 5. SOUND (the same numbers as in docs/game/CODE_GUIDE.md). This file never calls game.js: it only watches
// the page (body data-* attributes, the #finale layer, the film element, window.gameScore). Inside one closed
// function, in this order:
//   5a settings (tracks, gains, fades)       5b state and memory          5c which track for the screen
//   5d track players (laps, crossfades)      5e adaptive boss music       5f the clock (tick)
//   5g music button and slider               5h following the game        5i small interface sounds
//   5j loading ahead, window.gameSound
(function () {

  // ---------------------------------------------------------------------------------------------------
  // 5a. SETTINGS: the tracks, their loudness, the timings of the fades
  // ---------------------------------------------------------------------------------------------------
  // Each part of the game has a track; each remarkable galaxy has its own "boss" track. The gains even out
  // the loudness of the files. Times are in seconds.
  const KEY = "will-it-switch-off:sound", VOLUME_KEY = "will-it-switch-off:volume";
  const DEFAULT_VOLUME = 0.3, DIP = 0.4;            // DIP: share of the volume kept during the verdict
  const FADE_IN = 0.15, FADE_OUT = 0.3, CROSS = 0.4, END_FADE = 0.3;  // seconds: crisp (clean changes, no lag)
  const LAP = 1.5;   // seconds: each track crossfades into a fresh copy of itself this long before its end (an mp3 that
                     // simply loops can leave a short gap at the seam)
  // gain: evens out the loudness of the tracks; Cosmic Navigation is about 2 dB softer than the others, so they play
  // a little below it (see audio/CREDITS.md). end (optional): where a track's music stops if silence follows (it loops there)
  const TRACKS = {
    menu: { src: "audio/cosmic-navigation.mp3", gain: 1 },             // Cosmic Navigation
    choose: { src: "audio/space-echo.mp3", gain: 0.95 },               // Space Echo: slow and quiet, room to think
    film: { src: "audio/film-gravity-turn.mp3", gain: 0.95 },          // Gravity Turn: drive under the film (the student's pick)
    starFactory: { src: "audio/boss-star-factory.mp3", gain: 0.85 },        // Space Boss Battle
    fastestShutdown: { src: "audio/boss-fastest-shutdown.mp3", gain: 0.85 }, // Determined Pursuit
    jellyfish: { src: "audio/boss-stripped-galaxy.mp3", gain: 0.85 },        // Chase
  };
  // the boss track of each remarkable galaxy, by id
  const BOSS = { 395850: "starFactory", 269639: "fastestShutdown", 224668: "jellyfish" };
  const box = document.getElementById("sound-box");
  const button = document.getElementById("sound-toggle");
  const slider = document.getElementById("sound-volume");
  if (!button) return;

  // ---------------------------------------------------------------------------------------------------
  // 5b. STATE AND MEMORY: is the music on, at which volume
  // ---------------------------------------------------------------------------------------------------
  // The on/off choice and the volume are kept in the browser (localStorage), so they come back next visit.
  let on = false, openTimer = null, ticker = null, last = 0, volume = savedVolume();
  // master: the overall level (fades in and out, dips for the verdict); each player has its own crossfade share x
  const master = { v: 0, target: 0, rate: 1 };
  // the music steps back by half (-6 dB) for a moment under each small sound, so the sound is heard
  const duck = { v: 1, from: 0, until: 0 };
  let players = [];   // the track playing now is the last one; the others are fading out

  function store(key, value) { try { localStorage.setItem(key, value); } catch (error) { /* this visit only */ } }
  function wanted() { try { return localStorage.getItem(KEY) === "on"; } catch (error) { return false; } }
  function savedVolume() {
    try {
      const v = parseFloat(localStorage.getItem(VOLUME_KEY));
      return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
    } catch (error) { return DEFAULT_VOLUME; }
  }

  // ---------------------------------------------------------------------------------------------------
  // 5c. WHICH TRACK FOR WHAT IS ON SCREEN
  // ---------------------------------------------------------------------------------------------------
  // I read what game.js wrote on <body> (data-screen, data-mode, data-galaxy) to choose the track and its level.
  /** The track for what the page shows now. */
  function scene() {
    const d = document.body.dataset, screen = d.screen || "home";
    // a remarkable galaxy: its boss track on its intro, during its film, and after it (its muffled intro version again)
    if (d.mode === "showcase" && (screen === "meet" || screen === "film" || screen === "3d")) return BOSS[d.galaxy] || "starFactory";
    if (filmOver()) return "menu";                   // a game's film is over: its music stops, the game's intro music comes back
    if (screen === "choose") return "choose";
    if (screen === "meet" || screen === "film") return "film";
    return "menu";                                   // the home, the list of remarkable galaxies
  }

  /** A remarkable galaxy's film is over (its end panel, its 3D view): its boss track as on its intro screen. */
  const bossIntroAgain = () => document.body.dataset.mode === "showcase" && filmOver();

  /** The film has ended: its verdict (the large word, then the verdict screen), a remarkable galaxy's end panel, the 3D
   *  view. ("Watch again" plays the film again: its music again.) */
  function filmOver() {
    const screen = document.body.dataset.screen, fin = document.getElementById("finale");
    const end = document.querySelector('.phase[data-phase="show-end"]');
    return screen === "verdict" || screen === "3d" || (screen === "film" && ((fin && !fin.hidden) || (end && !end.hidden)));
  }

  // the target level: lower while the verdict is on screen
  function level() {
    const finale = document.getElementById("finale");
    const verdict = document.body.dataset.screen === "verdict" || (finale && !finale.hidden);
    return verdict ? volume * DIP : volume;
  }

  // ---------------------------------------------------------------------------------------------------
  // 5d. THE TRACK PLAYERS: loading ahead, laps without a gap, crossfades
  // ---------------------------------------------------------------------------------------------------
  // A "player" is one <audio> element with its own fade share x. A track never just loops (an mp3 can leave a
  // gap at the seam): shortly before its end a fresh copy fades in (a "lap"). Changing part crossfades tracks.
  // tracks loading in the background before they are needed (the music still off, or a part not reached yet), so a
  // track starts at once when it is asked for
  const primed = {};
  function prime(key, spare = false) {             // spare: one more, ready for a fresh start of a track playing now
    if (!TRACKS[key] || primed[key] || (!spare && players.some((p) => p.key === key))) return;
    const a = new Audio();
    a.preload = "auto";
    a.loop = true;
    a.src = TRACKS[key].src;
    primed[key] = a;
  }
  const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
  // a computer not saving data: room to load the sound ahead, before it is turned on (a phone waits for the music button)
  const ROOMY = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !(navigator.connection && navigator.connection.saveData);

  function makePlayer(key) {
    const track = TRACKS[key] || TRACKS.menu, audio = primed[key] || new Audio(track.src);
    if (primed[key] && preloading) setTimeout(() => prime(key, true), 0);   // the next one ready (a lap, a restart)
    delete primed[key];
    audio.volume = 0;                                // silent until the fade sets its level (a media element starts at full)
    audio.loop = true;
    audio.preload = "auto";
    const player = { key, audio, gain: track.gain, end: track.end, x: 0, target: 1, rate: 1 / CROSS };
    // a boss track goes through the filters of the adaptive music (where the browser has Web Audio)
    // a boss track goes through the filters of the adaptive music (where the browser has Web Audio)
    if (isBoss(key) && graph()) {
      try {
        player.node = ctx.createMediaElementSource(audio);
        player.vol = ctx.createGain();                 // its own level (fades, slider, mute), from silent
        player.vol.gain.value = 0;
        audio.volume = 1;                              // the element at full: in Chrome its volume still scales what it
                                                       // sends to Web Audio (at 0 the boss track is never heard)
        player.node.connect(player.vol);
        player.vol.connect(bus.hp);
      } catch (error) { player.node = null; player.vol = null; audio.volume = 0; /* plays as it is */ }
    }
    return player;
  }

  function release(player) {
    if (player.next) { release(player.next); player.next = null; }
    player.audio.pause(); player.audio.removeAttribute("src"); player.audio.load();
    if (player.node) { try { player.node.disconnect(); player.vol.disconnect(); } catch (error) { /* already gone */ } }
  }

  /** Where a track loops: where its music stops if silence follows, else its end. */
  function loopPoint(player) {
    const d = player.audio.duration;
    return player.end || (Number.isFinite(d) ? d : Infinity);
  }

  /** The next lap of the track playing now: a fresh copy fades in from its start while this one fades out. A phone
   *  may refuse a new sound without a tap: then this one stays and jumps back to its start at its loop point. */
  function lap(player) {
    const fresh = player.next || makePlayer(player.key);
    player.next = null;
    player.lapping = true;
    Object.assign(fresh, { x: 0, target: 1, rate: 1 / LAP });
    setPitch(fresh.audio, player.audio.playbackRate);          // a lap after a power-off keeps its lower pitch
    Object.assign(player, { target: 0, rate: 1 / LAP });
    players.push(fresh);
    const play = fresh.audio.play();
    if (play && play.catch) play.catch(() => {
      release(fresh);
      players = players.filter((q) => q !== fresh);
      Object.assign(player, { target: 1, rate: 1 / LAP, lapping: false, jumpBack: true });
    });
  }

  // play one track; if the browser refuses (no user gesture yet), the music is shown as off. Resolves to true when it plays.
  function playIt(player) {
    const play = player.audio.play();
    if (!play || !play.then) return Promise.resolve(true);
    return play.then(() => true, () => {
      if (players.length && player === players[players.length - 1]) { on = false; show(); }
      return false;
    });
  }

  function setMaster(target, seconds) {
    master.target = target;
    master.rate = seconds > 0 ? Math.max(Math.abs(target - master.v) / seconds, 0.001) : Infinity;
  }

  /** Crossfade to a part's track (already playing it: nothing changes; still fading out: it comes back). */
  function switchTo(key, cut = false) {
    const current = players[players.length - 1];
    if (current && current.key === key) return;
    let player = players.find((p) => p.key === key);
    if (player) players = players.filter((p) => p !== player);
    else player = makePlayer(key);
    const others = players.slice();
    players.push(player);
    player.target = 1;
    // cut (a film's end): its music stops at once with a short fade, without waiting for the next track
    if (cut) others.forEach((p) => { p.target = 0; p.rate = 1 / END_FADE; });
    const handOver = () => {
      if (players[players.length - 1] !== player) return;   // another part came first
      player.rate = 1 / CROSS;
      others.forEach((p) => { if (p.target !== 0) { p.target = 0; p.rate = 1 / CROSS; } });
    };
    if (!player.audio.paused && player.audio.readyState >= 3) { handOver(); return; }
    player.rate = 0;                                  // it waits, silent, until it really plays (no gap in between)
    player.audio.addEventListener("playing", handOver, { once: true });
    setTimeout(handOver, 1200);                       // a slow load: change anyway
    if (on) playIt(player);
  }

  // one small step of a fade: I move `value` towards `target` by rate × dt, never past it
  function step(value, target, rate, dt) {
    if (value < target) return Math.min(target, value + rate * dt);
    return Math.max(target, value - rate * dt);
  }

  // ---------------------------------------------------------------------------------------------------
  // 5e. ADAPTIVE BOSS MUSIC for the three remarkable galaxies
  // ---------------------------------------------------------------------------------------------------
  // The boss track goes through Web Audio filters (high-pass, low-pass, gain) whose "dials" follow the galaxy's
  // real numbers from game.json, in step with the film. Crossing the switched-off line fires a boom and a collapse.
  // ---- adaptive music for the three remarkable galaxies (one grammar for all three; the design note with its sources
  // is adaptive-music-design.md in the project's notes):
  // - reading the intro = the build: the boss track enters muffled and opens slowly;
  // - "Watch its life" = the drop: a moment of near-silence, an impact, the full track;
  // - during the film, two dials from the galaxy's real numbers in game.json, in step with the film's clock:
  //   energy = star formation (brighter and louder), body = fuel, its star-forming gas (the bass thins as it drains);
  //   while the galaxy still makes stars, the music stays clear (never below FILM_LP and FILM_GAIN): its quietest
  //   moments are a little softer, its burst the brightest and loudest;
  // - crossing the switched-off line = one boom, as strong as the crossing is sharp; the music then collapses (muffled
  //   down to LP_SHUT as its star formation falls), a crash also powers it down (its pitch slides down), and a quiet
  //   dark drone stays.
  const LP_SHUT = 350, LP_OPEN = 16000, HP_FULL = 20, HP_THIN = 300, DECADES = 2.5;
  const FILM_LP = 3500, FILM_GAIN = 0.75, COLLAPSE_MS = 2000;
  const BUILD_FROM = 350, BUILD_TO = 1200, BUILD_MS = 25000, POWER_OFF_S = 1.4, POWER_OFF_RATE = 0.85;
  // crisp timing: the drop's hit lands DROP_S after "Watch its life" (the impact starts right at its hit: the swell
  // before it is a burst of static, harsh when cut into); a switch-off is set on the audio clock up to LOOKAHEAD ahead, to sound on the film's very frame; its
  // collapse falls with a time constant of CRISP seconds
  const IMPACT_HIT = 0.743, DROP_S = 0.006, BOOM_HIT = 0.205, LOOKAHEAD = 0.25, CRISP = 0.04;
  let ctx = null, bus = null, drone = null;
  const score = { galaxy: null, data: null, meetAt: 0, dropAt: 0, fired: false, offAt: 0, steep: 0, lastScreen: "", shape: null,
    holdUntil: 0, pending: [] };

  function isBoss(key) { return Object.values(BOSS).includes(key); }

  /** The filters and gain the boss tracks go through, made on the first tap that turns the sound on. */
  function graph() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), gain = ctx.createGain();
      hp.type = "highpass"; hp.frequency.value = HP_FULL;
      lp.type = "lowpass"; lp.frequency.value = LP_OPEN;
      hp.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
      bus = { hp, lp, gain };
    } catch (error) { ctx = null; bus = null; }
    return ctx;
  }

  function setPitch(audio, rate) {
    const keep = rate === 1;                       // a power-off lowers the pitch with the speed, like a machine stopping
    audio.preservesPitch = keep; audio.mozPreservesPitch = keep; audio.webkitPreservesPitch = keep;
    audio.playbackRate = rate;
  }

  /** A galaxy's numbers, ready for the dials: log SFR and log fuel scaled to its own range, and where it crosses the
   *  switched-off line (in snapshots) with how sharply (decades of sSFR per snapshot). */
  function galaxyData(id) {
    const gs = window.gameScore, s = gs && gs.series(id);
    if (!s) return null;
    const lg = (v) => Math.log10(Math.max(v || 0, 1e-30));   // (a zero would be minus infinity)
    const sfr = s.sfr.map(lg), fuel = s.mgas_sf.map(lg), ssfr = s.ssfr.map(lg), off = Math.log10(gs.offLine);
    let cross = null, steep = 0;
    for (let i = 1; i < ssfr.length; i += 1) {
      if (ssfr[i - 1] >= off && ssfr[i] < off) {
        // the first drop below the line: I place the crossing between the two snapshots by a straight line in log sSFR
        cross =s.snap[i - 1] + (ssfr[i - 1] - off) / (ssfr[i - 1] - ssfr[i]);
        steep = ssfr[i - 1] - ssfr[i];
        break;
      }
    }
    return { snap: s.snap, sfr, fuel, sfrMax: Math.max(...sfr), fuelMax: Math.max(...fuel), cross, steep };
  }

  /** Where the film is, in snapshots: the past film runs from the first snapshot to the decision, the future film from
   *  the decision on, with the holds the films were rendered with. */
  function filmSnapshot() {
    const v = document.getElementById("film"), gs = window.gameScore;
    if (!v || !gs || !v.currentSrc) return null;
    // f: the frame on screen; the past film holds hold_start frames, then past_frames per snapshot
    const T = gs.timeline, f = v.currentTime * gs.fps, steps = gs.decision - gs.first;
    if (v.currentSrc.includes("future")) return gs.decision + Math.min(steps, Math.max(0, f / T.future_frames));
    return gs.first + Math.min(steps, Math.max(0, (f - T.hold_start) / T.past_frames));
  }

  // a series' value at snapshot `snap` (which can fall between two snapshots): a straight line between them
  function at(series, d, snap) {
    const x = Math.min(d.snap.length - 1, Math.max(0, snap - d.snap[0])), i = Math.min(d.snap.length - 2, Math.floor(x)), u = x - i;
    return series[i] + (series[i + 1] - series[i]) * u;
  }

  /** The dials' settings for what is on screen now, or null to hold them where they are. */
  function shape(now) {
    const b = document.body.dataset;
    if (b.mode !== "showcase" || !score.data) return { lp: LP_OPEN, hp: HP_FULL, gain: 1, tc: 0.3 };
    if (b.screen === "meet" || bossIntroAgain()) {                 // the build, while you read (and after the film)
      const u = Math.min(1, (now - score.meetAt) / BUILD_MS);
      return { lp: BUILD_FROM * Math.pow(BUILD_TO / BUILD_FROM, u), hp: HP_FULL, gain: 0.8, tc: 0.25 };
    }
    if (b.screen !== "film") return null;                          // the end panel, 3D: as the film left it
    if (now < score.dropAt) return { lp: BUILD_FROM, hp: HP_FULL, gain: 0.04, tc: 0.02 };   // the breath before the drop
    const s = filmSnapshot();
    if (s === null) return null;
    const down = score.fired && now >= score.offAt;                // switched off: the collapse
    const fresh = now - score.dropAt < 400;                        // the drop opens at once, then the data glides
    const falling = down && now - score.offAt < COLLAPSE_MS;       // ... the collapse follows the data closely
    return { ...dialsAt(s, down), tc: fresh ? 0.05 : falling ? CRISP : 0.15, s };
  }

  /** The dials for a moment of the galaxy's life (snapshot s), before or after its switch-off. */
  function dialsAt(s, down) {
    const d = score.data;
    // e (energy) and f (fuel) go from 0 to 1: 1 at the galaxy's own peak, 0 at DECADES (2.5) powers of ten below it
    const e = Math.min(1, Math.max(0, 1 + (at(d.sfr, d, s) - d.sfrMax) / DECADES));
    const f = Math.min(1, Math.max(0, 1 + (at(d.fuel, d, s) - d.fuelMax) / DECADES));
    // more energy opens the low-pass (brighter) and raises the gain; less fuel raises the high-pass (thinner bass);
    // frequencies move on a log scale, as the ear hears them
    const lo = down ? LP_SHUT : FILM_LP, g0 = down ? 0.45 : FILM_GAIN;
    return { lp: lo * Math.pow(LP_OPEN / lo, e), hp: HP_FULL * Math.pow(HP_THIN / HP_FULL, 1 - f), gain: g0 + (1 - g0) * e, e, f };
  }

  /** The audio's own delay to the ear (so a sound set for a frame leaves the speakers as the frame shows). */
  const outLatency = () => (ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0);
  const crisp = (name) => Boolean(ctx && ctx.state === "running" && sfxBuf[(SFX[name] && SFX[name].use) || name]);

  /** Seconds (of real time) until the film reaches the switched-off line, or null when it is not ahead in this clip. */
  function untilCross(cross) {
    const v = document.getElementById("film"), gs = window.gameScore;
    if (!v || v.paused || !gs || !v.currentSrc) return null;
    const T = gs.timeline, future = v.currentSrc.includes("future");
    if (future ? cross < gs.decision : cross > gs.decision) return null;
    const t = future ? ((cross - gs.decision) * T.future_frames) / gs.fps : (T.hold_start + (cross - gs.first) * T.past_frames) / gs.fps;
    return (t - v.currentTime) / (v.playbackRate || 1);
  }

  /** "Watch its life": the music hushes at once, the impact's last swell rises, and on its hit the music opens. */
  function drop(now) {
    if (!crisp("impact") || !score.data) {            // no Web Audio sounds: the impact in full, the music opens on its hit
      score.dropAt = now + IMPACT_HIT * 1000;
      sfx("impact");
      return;
    }
    const t = ctx.currentTime, hit = t + DROP_S, o = dialsAt(score.data.snap[0], false);   // the film's first moment
    sfx("impact", 1, t);
    score.dropAt = now + DROP_S * 1000;
    score.holdUntil = score.dropAt + 40;
    for (const [param, quiet, open] of [[bus.lp.frequency, BUILD_FROM, o.lp], [bus.hp.frequency, HP_FULL, o.hp], [bus.gain.gain, 0.04, o.gain]]) {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(quiet, t, 0.01);
      param.setTargetAtTime(open, hit, 0.03);
    }
  }

  /** The switched-off line: the boom (its hit, no swell), the collapse and the drone, all at once, `lead` seconds from
   *  now (the frame where the galaxy crosses the line). */
  function switchOff(now, lead, d) {
    const ahead = Math.max(0, lead - outLatency()), when = ctx ? ctx.currentTime + ahead : 0;
    score.fired = true;
    score.offAt = now + ahead * 1000;
    score.steep = d.steep;
    score.pending = [sfx("boom", Math.min(1, Math.max(0.3, d.steep / 0.7)), when)];
    if (d.steep < 0.5) score.pending.push(sfx("air", 1, when));   // a slow crossing: the boom with a falling breath of air
    startDrone(when);
    if (!ctx) return;
    const c = dialsAt(d.cross, true);
    score.holdUntil = score.offAt + 40;
    for (const [param, value] of [[bus.lp.frequency, c.lp], [bus.hp.frequency, c.hp], [bus.gain.gain, c.gain]]) {
      param.cancelScheduledValues(ctx.currentTime);
      param.setTargetAtTime(value, when, CRISP);
    }
  }

  function setDial(param, value, tc) {
    const t = ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, tc);
  }

  /** Each tick: follow the screen and the film, set the dials, fire the switch-off. */
  function adapt(now) {
    if (!bus) return;
    const b = document.body.dataset;
    if (b.mode === "showcase" && b.galaxy && b.galaxy !== score.galaxy) {
      Object.assign(score, { galaxy: b.galaxy, data: galaxyData(b.galaxy), fired: false });
      endPowerOff();
    }
    if (b.screen !== score.lastScreen) {                           // a new screen: the build starts, or the drop
      if (b.screen === "meet") score.meetAt = now;
      if (b.screen === "film" && score.lastScreen === "meet" && b.mode === "showcase") drop(now);
      if (b.screen !== "film" && b.screen !== "verdict" && b.screen !== "3d") { score.fired = false; endPowerOff(); }
      score.lastScreen = b.screen;
    }
    const sh = shape(now);
    if (sh && now >= score.holdUntil) {              // (a change set ahead on the audio clock is left to happen)
      setDial(bus.lp.frequency, sh.lp, sh.tc);
      setDial(bus.hp.frequency, sh.hp, sh.tc);
      setDial(bus.gain.gain, sh.gain, sh.tc);
    }
    if (sh) score.shape = sh;
    // the switched-off line, crossed in the film (and back before it, on "Watch again": all undone). Its moment in the
    // film is known: within LOOKAHEAD of it, everything is set on the audio clock for that very frame.
    const d = score.data, s = sh && sh.s;
    if (b.mode === "showcase" && b.screen === "film" && !filmOver() && d && d.cross !== null && typeof s === "number") {
      if (!score.fired) {
        const lead = untilCross(d.cross);
        if (s >= d.cross) switchOff(now, 0, d);
        else if (lead !== null && lead <= LOOKAHEAD && crisp("boom")) switchOff(now, lead, d);
      } else if (now > score.offAt + 100 && s < d.cross - 0.05) {
        score.fired = false;
        endPowerOff();
      }
    }
    // a crash powers the music down: its pitch slides down over 1.4 s
    if (score.fired && score.steep >= 0.5 && now >= score.offAt && !filmOver()) {
      const u = Math.min(1, (now - score.offAt) / 1000 / POWER_OFF_S);
      const r = 1 - (1 - POWER_OFF_RATE) * u;
      players.forEach((p) => { if (isBoss(p.key) && Math.abs(p.audio.playbackRate - r) > 0.004) setPitch(p.audio, r); });
    }
    if (drone) drone.level(Math.min(1, master.v * 0.6 * (score.fired && b.mode === "showcase" && !filmOver() ? 1 : 0)));   // (it ends with the film)
  }

  function endPowerOff() {
    players.forEach((p) => { if (p.audio.playbackRate !== 1) setPitch(p.audio, 1); });
    if (drone) { drone.stop(); drone = null; }
    score.pending.forEach((src) => { try { if (src) src.stop(); } catch (error) { /* already over */ } });   // set ahead, not heard yet
    score.pending = [];
    score.holdUntil = 0;
  }

  /** The dark drone of a galaxy that has switched off: from its decoded sound, looping, set to start with the boom. */
  function startDrone(when = 0) {
    if (drone || !on) return;
    if (crisp("drone")) {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = sfxBuf.drone;
      src.loop = true;
      g.gain.value = 0;
      src.connect(g);
      g.connect(ctx.destination);
      src.start(Math.max(ctx.currentTime, when));
      drone = {
        level: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.05),
        stop: () => { try { src.stop(); } catch (error) { /* not started */ } src.disconnect(); g.disconnect(); },
      };
      return;
    }
    const a = new Audio("audio/sfx/dark-drone.mp3");
    a.loop = true;
    a.volume = 0;
    drone = { level: (v) => { a.volume = Math.min(1, v); }, stop: () => a.pause() };
    const play = a.play();
    if (play && play.catch) play.catch(() => { drone = null; });   // no file or refused: no drone
  }

  // ---------------------------------------------------------------------------------------------------
  // 5f. THE CLOCK: one tick, 30 times a second
  // ---------------------------------------------------------------------------------------------------
  // Each tick moves every fade one small step, dips the music under small sounds, starts laps, lets go of the
  // tracks that have faded out, and updates the adaptive music. With the music off and silent, it stops.
  function tick() {
    const now = performance.now(), dt = Math.min(0.5, (now - last) / 1000);
    duck.v = step(duck.v, now >= duck.from && now < duck.until ? 0.5 : 1, 1 / 0.06, dt);   // 60 ms down, 60 ms back up
    last = now;
    master.v = step(master.v, master.target, master.rate, dt);
    players.forEach((p) => {
      p.x = step(p.x, p.target, p.rate, dt);
      // a track's loudness = the overall level × its file's gain × its crossfade share × the dip under small sounds
      const level = Math.min(1, Math.max(0, master.v * p.gain * p.x * duck.v));
      if (p.vol) p.vol.gain.setTargetAtTime(level, ctx.currentTime, 0.02);
      else p.audio.volume = level;
      // no lap possible (refused): back to the start at the loop point, before any silence or gap
      if (p.jumpBack && !p.audio.paused && p.audio.currentTime >= loopPoint(p) - 0.035) p.audio.currentTime = 0;
    });
    adapt(now);
    // the track playing now: load its next lap a few seconds ahead, then start it
    const current = players[players.length - 1];
    if (on && current && current.target === 1 && !current.lapping && !current.jumpBack && !current.audio.paused) {
      const at = loopPoint(current), t = current.audio.currentTime;
      if (Number.isFinite(at)) {
        if (!current.next && t >= at - LAP - 8) current.next = makePlayer(current.key);
        if (t >= at - LAP) lap(current);
      }
    }
    // drop the tracks that have faded out
    players = players.filter((p) => {
      if (p.target === 0 && p.x === 0) { release(p); return false; }
      return true;
    });
    // faded out after "off": pause everything and stop ticking
    if (!on && master.v === 0) {
      players.forEach((p) => p.audio.pause());
      clearInterval(ticker); ticker = null;
    }
  }

  function run() {
    if (ticker) return;
    last = performance.now();
    ticker = setInterval(tick, 1000 / 30);
  }

  // ---------------------------------------------------------------------------------------------------
  // 5g. THE MUSIC BUTTON AND ITS VOLUME SLIDER
  // ---------------------------------------------------------------------------------------------------
  // start() and stop() turn the music on and off with a fade. Browsers only allow sound after a click or a tap,
  // so a player who left the music on gets it back at their first gesture on the page.
  // touch screens (no hover): the slider opens for a few seconds after the music starts or the slider is used
  function openSlider() {
    if (!box) return;
    box.classList.add("open");
    clearTimeout(openTimer);
    openTimer = setTimeout(() => box.classList.remove("open"), 4000);
  }

  function show() {
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.setAttribute("aria-label", on ? "Turn the music off" : "Turn the music on");
    button.title = on ? "Music on" : "Music off";
    if (box) box.classList.toggle("playing", on);
    if (slider) {
      slider.value = String(Math.round(volume * 100));
      slider.style.setProperty("--fill", `${Math.round(volume * 100)}%`);
      slider.setAttribute("aria-valuetext", `${Math.round(volume * 100)} percent`);
    }
  }

  function start() {
    on = true; show(); openSlider();
    if (graph() && ctx.state === "suspended") ctx.resume().catch(() => {});   // the tap that turns the sound on wakes it
    preloadAll();                                    // every sound loads now (if not yet): nothing waits after this
    // the track of the part on screen, at full share (a track left from another part is let go)
    const key = scene(), current = players[players.length - 1];
    if (!current || current.key !== key) {
      players.forEach(release);
      const player = makePlayer(key);
      player.x = 1;
      players = [player];
    }
    const playing = Promise.all(players.map(playIt)).then((all) => all[all.length - 1]);
    setMaster(level(), FADE_IN);
    run();
    return playing;
  }

  // every sound loaded ahead, so no change of music or sound ever waits for the network: the small sounds decoded into
  // memory, and each music track downloaded in full, low priority and one after another (the part on screen first),
  // with a player ready on it. (Decoding the six tracks too would take about 240 MB of memory: a track already
  // downloaded starts in a few hundredths of a second anyway.)
  let preloading = null;
  function preloadAll() {
    if (preloading) return preloading;
    loadSfx(true);
    const first = scene(), keys = [first, ...Object.keys(TRACKS).filter((k) => k !== first)];
    const full = (src) => (window.fetch ? fetch(src, { priority: "low" }).then((r) => r.arrayBuffer()).catch(() => null) : Promise.resolve(null));
    preloading = keys.reduce((chain, key) => chain.then(() => full(TRACKS[key].src)).then(() => prime(key)), Promise.resolve());
    return preloading;
  }

  function stop() {
    on = false; show();
    if (drone) { drone.stop(); drone = null; }
    if (box) { clearTimeout(openTimer); box.classList.remove("open"); }
    setMaster(0, FADE_OUT);
    run();
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (on) stop(); else start();
    store(KEY, on ? "on" : "off");
  });

  if (slider) {
    slider.addEventListener("input", () => {
      volume = Math.min(1, Math.max(0, Number(slider.value) / 100));
      store(VOLUME_KEY, String(volume));
      openSlider();
      if (!on && volume > 0) { start(); store(KEY, "on"); }   // moving the slider while off turns the music on
      else if (on) { master.v = master.target = level(); }
      show();
    });
    slider.addEventListener("click", (event) => event.stopPropagation());
  }

  // remembered as on: start at the first gesture on the page that the browser accepts for sound. On phones a
  // pointerdown is not enough (only the touchend or click after it), so keep listening until play() succeeds.
  if (wanted()) {
    const GESTURES = ["pointerup", "touchend", "click", "keydown"];
    const stopListening = () => GESTURES.forEach((name) => window.removeEventListener(name, resume, true));
    let trying = false;
    function resume(event) {
      if (event.target instanceof Node && (box || button).contains(event.target)) { stopListening(); return; }   // the sound controls decide for themselves
      if (on || trying) return;
      trying = true;
      start().then((ok) => { trying = false; if (ok) stopListening(); else stop(); });
    }
    GESTURES.forEach((name) => window.addEventListener(name, resume, true));
  }

  // ---------------------------------------------------------------------------------------------------
  // 5h. FOLLOWING THE GAME: a new screen, a new track
  // ---------------------------------------------------------------------------------------------------
  // I watch <body>'s data attributes (a MutationObserver): each time game.js changes the screen, I follow it.
  // a new part of the game: its track (crossfading); the verdict: a dip, back up after
  let wasOver = false;
  const follow = () => {
    const over = filmOver(), ended = over !== wasOver;
    wasOver = over;
    if (!on) return;
    const key = scene(), current = players[players.length - 1];
    if (isBoss(key) && current && current.key === key && ended) restart(key, over);   // a remarkable galaxy's film ends, or plays again
    else switchTo(key, key === "menu" && Boolean(current) && current.key !== "menu" && over);
    setMaster(level(), CROSS);
    run();
    adapt(performance.now());                       // the drop and the dials answer the change at once, not at the next tick
  };

  /** The same boss track afresh from its start: its muffled intro version when the film ends (as on its intro
   *  screen), its film version when it plays again. The track playing goes with a short fade. */
  function restart(key, over) {
    const fresh = makePlayer(key);
    players.forEach((p) => { p.target = 0; p.rate = 1 / END_FADE; });
    Object.assign(fresh, { target: 1, rate: 1 / END_FADE });
    players.push(fresh);
    if (over) score.meetAt = performance.now();      // the build starts again, muffled
    playIt(fresh);
  }
  new MutationObserver(follow).observe(document.body, { attributes: true, attributeFilter: ["data-screen", "data-mode", "data-galaxy"] });
  const finale = document.getElementById("finale");
  if (finale) new MutationObserver(follow).observe(finale, { attributes: true, attributeFilter: ["hidden"] });

  // ---------------------------------------------------------------------------------------------------
  // 5i. SMALL SOUNDS OF THE INTERFACE: clicks, hover ticks, the bet, the verdict
  // ---------------------------------------------------------------------------------------------------
  // Decoded once into memory, then played on the audio clock (no delay). If that is not possible, a copy of an
  // <audio> element plays instead. Clicks are caught for the whole page in one place.
  // ---- small sounds of the interface, only while the sound is on and at the slider's volume: a soft click for buttons,
  // answers and cards, a richer one for Start, "Watch its life" and "Show the future", a "locked in" for the bet, and a
  // short sting when the verdict appears (switched off, or kept making stars)
  const SFX = {
    click: { src: "audio/sfx/ui-click.mp3", gain: 0.6 },
    // the pointer (or the keyboard) moving onto something to press: the same tick, higher and about 12 dB softer, no dip
    hover: { src: "audio/sfx/ui-click.mp3", use: "click", gain: 0.15, rate: 1.6, light: true },
    start: { src: "audio/sfx/ui-start.mp3", gain: 0.7 },
    bet: { src: "audio/sfx/bet-lock.mp3", gain: 0.8 },
    off: { src: "audio/sfx/verdict-off.mp3", gain: 0.9 },
    on: { src: "audio/sfx/verdict-on.mp3", gain: 0.9 },
    impact: { src: "audio/sfx/watch-impact.mp3", gain: 1, at: IMPACT_HIT - DROP_S },   // the drop on "Watch its life"
    boom: { src: "audio/sfx/shutdown-boom.mp3", gain: 1, at: BOOM_HIT },  // crossing the switched-off line: its hit at once
    air: { src: "audio/sfx/fade-air.mp3", gain: 0.9 },            // ... slowly
    drone: { src: "audio/sfx/dark-drone.mp3", gain: 1 },          // (played by startDrone)
  };
  // `at`: where a sound starts in its file (the part before is left out, so its hit comes at once)

  // the small sounds are fetched and decoded once, in the background (with an offline context: no sound device is
  // opened before the music is turned on), then each plays from memory on the audio clock: no load, no decoder start
  const sfxBuf = {}, sfxEl = {}, asked = new Set();
  let dec;
  /** Fetch and decode the small sounds (the long drone only with `drone`: it is needed only once the sound is on). */
  function loadSfx(drone = false) {
    if (dec === undefined) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      try { dec = OAC && window.fetch ? new OAC(1, 1, 48000) : null; } catch (error) { dec = null; }
    }
    if (!dec) return;
    for (const [name, s] of Object.entries(SFX)) {
      if (asked.has(name) || s.use || (name === "drone" && !drone)) continue;   // (`use`: another sound's file)
      asked.add(name);
      fetch(s.src, { priority: "low" })
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => dec.decodeAudioData(data))
        .then((buffer) => { sfxBuf[name] = buffer; })
        .catch(() => { /* this one plays as a media copy */ });
    }
  }
  function duckAt(t) { duck.from = t; duck.until = t + 300; run(); }
  /** A small sound now (or at `when`, on the audio clock). Returns its source when it is set on the audio clock. */
  function sfx(name, strength = 1, when = 0) {
    const s = SFX[name];
    if (!on || !s || volume === 0) return null;
    const level = Math.min(1, (volume / DEFAULT_VOLUME) * 0.9 * s.gain * strength);   // about 5 dB above where it was
    if (crisp(name)) {
      const t = Math.max(ctx.currentTime, when), src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = sfxBuf[s.use || name];
      if (s.rate) src.playbackRate.value = s.rate;
      src.connect(g);
      g.connect(ctx.destination);
      if (s.at) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.004); }   // cut in: a 4 ms edge, no click
      else g.gain.value = level;
      src.onended = () => { src.disconnect(); g.disconnect(); };
      src.start(t, s.at || 0);
      if (!s.light) duckAt(performance.now() + (t - ctx.currentTime) * 1000);
      return src;
    }
    if (s.light) return null;                       // a hover tick only from memory: never a media copy
    // no Web Audio, or not decoded yet: a media copy, as before (so the same sound can overlap itself)
    if (!sfxEl[name]) { sfxEl[name] = new Audio(s.src); sfxEl[name].preload = "auto"; }
    const a = sfxEl[name].cloneNode();
    a.volume = level;
    duckAt(performance.now());
    const play = a.play();
    if (play && play.catch) play.catch(() => {});   // a missing file or a refused sound: nothing to hear, nothing breaks
    return null;
  }
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("button") : null;
    if (!el || el.disabled || (box && box.contains(el))) return;   // the music button and its slider make no click
    if (el.matches("[data-guess]")) sfx("bet");
    else if (el.id === "go-choose" || el.id === "meet-go" || el.id === "play-future") sfx("start");
    else sfx("click");
  }, true);
  // a soft tick each time the pointer moves onto a button, a card, an answer or a remarkable galaxy on the map (a mouse
  // or a pen: a finger has no hover), and when the keyboard moves to one. Sweeping across a row ticks once per button,
  // at most one tick every 40 ms.
  let hovered = null, lastTick = 0, skyHand = false;
  function tickOn(el) {
    if (el === hovered) return;                     // still on the same one (or between its own words)
    hovered = el;
    if (!el || el.disabled || (box && box.contains(el))) return;
    const now = performance.now();
    if (now - lastTick < 40) return;
    lastTick = now;
    sfx("hover");
  }
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    tickOn(event.target instanceof Element ? event.target.closest("button") : null);
  }, true);
  document.addEventListener("focusin", (event) => {
    const el = event.target instanceof Element ? event.target.closest("button") : null;
    if (el && el.matches(":focus-visible")) { hovered = null; tickOn(el); }   // the keyboard (not a click's focus)
  });
  // the map's remarkable galaxies: the sky's pointer turns into a hand over one (game.js)
  const skyEl = document.getElementById("sky");
  if (skyEl) {
    new MutationObserver(() => {
      const hand = skyEl.style.cursor === "pointer";
      if (hand && !skyHand) tickOn(skyEl);
      else if (!hand && hovered === skyEl) hovered = null;
      skyHand = hand;
    }).observe(skyEl, { attributes: true, attributeFilter: ["style"] });
  }
  // the verdict: in a game, when its word appears in large type; for a remarkable galaxy, when its end panel appears
  if (finale) {
    let shown = false;
    new MutationObserver(() => {
      const now = finale.classList.contains("word");
      if (now && !shown) sfx(document.getElementById("finale-word")?.classList.contains("off") ? "off" : "on");
      shown = now;
    }).observe(finale, { attributes: true, attributeFilter: ["class"] });
  }
  const showEnd = document.querySelector('.phase[data-phase="show-end"]');
  if (showEnd) {
    new MutationObserver(() => {
      if (!showEnd.hidden) sfx(document.getElementById("show-truth")?.classList.contains("off") ? "off" : "on");
      follow();                                     // its end panel (or "Watch again"): the music changes with it
    }).observe(showEnd, { attributes: true, attributeFilter: ["hidden"] });
  }

  // ---------------------------------------------------------------------------------------------------
  // 5j. LOADING AHEAD, AND A READ-ONLY WINDOW FOR CHECKS
  // ---------------------------------------------------------------------------------------------------
  // On a computer I load the sounds once the page has settled; on a phone only when the music button is touched.
  // ready for the tap that turns the sound on: the small sounds decode and the track of the part on screen loads. On a
  // computer (not saving data) when the page has settled; on a phone (mobile data) only once the music button is touched
  // or focused, so a player who never turns the sound on downloads nothing
  const ready = () => { preloadAll(); };
  if (ROOMY) {
    const warm = () => idle(ready);
    if (document.readyState === "complete") warm(); else window.addEventListener("load", warm, { once: true });
  }
  ["pointerenter", "pointerdown", "touchstart", "focusin"].forEach((name) => (box || button).addEventListener(name, ready, { once: true, passive: true }));

  // the adaptive music's state, for checking by measurement (read only)
  window.gameSound = { state: () => ({ on, galaxy: score.galaxy, shape: score.shape, fired: score.fired, graph: Boolean(bus),
    cross: score.data ? score.data.cross : null, steep: score.data ? score.data.steep : null,
    rate: players.length ? players[players.length - 1].audio.playbackRate : 1, drone: Boolean(drone),
    tracks: players.map((p) => [p.key, +p.x.toFixed(2), p.target, +p.audio.currentTime.toFixed(1), +p.audio.volume.toFixed(2), Boolean(p.vol)]) }) };

  show();
})();
