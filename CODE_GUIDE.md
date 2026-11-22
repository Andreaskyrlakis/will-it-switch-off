# Code guide: "Will it switch off?"

This guide is a map of the game's code: which file does what, in which block, and how the data travels from the
TNG simulation to the screen. Every file uses the same block numbers, so "block 2" always means data processing.

| Block | Name | In one line |
|---|---|---|
| 0 | Settings | constants, folders, timings, words shown on screen |
| 1 | Data | reading the TNG catalogue, snapshots and particles (Python); loading `game.json` / `map.json` (page) |
| 2 | Data processing | the pool of galaxies, the boxes, the model's chances, the facts; in the page, answers -> box -> galaxy |
| 3 | Rendering | galaxy films, cosmic-web background, 3D clouds (Python); the sky of points and the 3D view (page) |
| 4 | Interface and animations | every screen, its transitions, the gauge, the charts (page); writing the files (Python) |
| 5 | Sound | music by part of the game, adaptive "boss" music, small interface sounds (`sound.js`) |
| 6 | Wiring | `init()` in `game.js`: load the data, connect the buttons |

In the Python scripts, block 4 is "writing the files" and block 5 is "running the script" (the command line).
Inside a long block, sub-blocks are lettered in the order of the file (4a, 4b, ...). The letters are per file:
"4c" in `game.js` (the film) is not "4c" in `game.css` (the opening), because the CSS order can never change.

## 1. The data flow, from TNG to the screen

```
TNG100-1 catalogue + merger trees + snapshots 72..84 (TNG JupyterLab)
  │
  │  src/game_galaxies.py   pool of training galaxies, model's out-of-part chance, boxes, one galaxy per box
  ▼
data/game/game_galaxies.csv, game_pool.csv
  │
  │  src/tng_game_render.py   (on the Lab) reads each galaxy's particles, renders the past/future films,
  │                           the posters, the labels and the 3D particle extracts
  │  src/game_showcase_motion.py   the "motion" films of the remarkable galaxies (particles follow paths)
  │  src/game_cosmic_web.py + game_cosmic_web_images.py   the cosmic-web background (docs/game/bg/)
  ▼
data/game/lab/<id>/  (films, posters, quantities.csv, meta.json, extracts/*.f32)
  │
  │  src/game_assets.py   packs everything for the page
  ▼
docs/game/data/game.json   docs/game/data/map.json   docs/game/media/<id>/*.mp4, *.jpg, cloud_*.bin
  │
  │  game.js  init(): fetch game.json + map.json        (block 6)
  │  game.js  answers -> box -> galaxy                   (block 2)
  │  sky.js   draws the 12,710 points                    (block 3)
  │  game.js  screens, film, bet, gauge, verdict          (block 4)
  │  charts.js the live chart under the film              (block 4)
  │  viewer3d.js reads cloud_<snap>.bin, draws in 3D      (block 3)
  │  sound.js follows <body data-screen/data-mode>        (block 5)
  ▼
the screen
```

## 2. Python scripts (`src/`)

| File | Blocks | Main functions |
|---|---|---|
| `game_galaxies.py` | 0 settings, 1 data, 2 processing, 4 writing, 5 running | `saved_settings()` reads notebook 14's Optuna settings; `out_of_part_probability()` scores each training galaxy with the models that never saw it; `build_pool()` keeps the galaxies followed cleanly from snapshot 72 to 84; `pick()` cuts the boxes (size × gas × wind × place) and picks the most typical galaxy (and a "quencher"); `main()` writes the CSVs |
| `tng_game_render.py` | 0, 2, 3, 1, 3, 2, 4, 5 (long file: some blocks come back, marked "continued") | data: `read_snapshot()`, `open_tree()`, `branch()`, `face_on_rotation()`; processing: `Clock`, `schedule()`, `blend_weight()`, `host_distance()`; rendering: `splat_spline()`, `gas_surface_density()`, `star_maps()`, `render_galaxy()`, `compose_films()`; writing: `pack()`; running: `run()`, `main()` |
| `game_showcase_motion.py` | 0, 1, 2, 3, 4, 5 | `load_snapshot()`; `smooth()` and class `Pair` (each particle's path between two saved moments); `gas_image()`, `star_image()`, `palette_luts()`; `render()`, `main()` |
| `game_showcase_mockups.py` | 0, 3, 4, 5 | still mock-ups of the remarkable galaxies' looks: `maps()`, `compose()`, `palettes()`, `main()` |
| `game_cosmic_web.py` | 0, 1, 2, 3, 4, 5 (inside `main()`) | a 22 Mpc slice of TNG100-3 gas at snapshot 78, spread into a density image |
| `game_cosmic_web_images.py` | 0, 3, 4 | `tone()`, `colorize()`, `quiet_shift()`; `main()` writes the desktop and phone JPEGs of `docs/game/bg/` |
| `game_assets.py` | 0, 2, 3, 4, 5 | `cloud()` packs particles into 10-byte records; `series()` and `galaxy_entry()` build one galaxy's entry; `main()` writes `game.json`, `map.json` and the media folders |
| `game_sharpness_test.py` | 0, 3, 4, 5 | a side test comparing rendering kernels (not used by the page) |

## 3. The page (`docs/game/`)

| File | Blocks | What is where |
|---|---|---|
| `index.html` | (structure) | one `<section class="screen" id="screen-…">` per screen; a map of the screens at the top of `<body>` |
| `game.js` | 0 to 6 | the whole game; see the table below |
| `sky.js` | 0, 3a–3f | class `Sky`: the 12,710 points, their halos and twinkle, the narrowed and coloured looks, the marks on the home map |
| `charts.js` | 0, 2a–2b, 4a–4b | film time -> cosmic time (`filmPosition`, `lookbackAt`); the drawing kit; the charts (`drawSsfr`, `drawFuel`, `drawDistance`, `drawTimeCurve`) |
| `viewer3d.js` | 0, 3a–3j | class `GalaxyViewer` (three.js): particle colours, shaders, camera and opening glide, automatic exposure, loading and reading `cloud_<snap>.bin`, fading two clouds |
| `sound.js` | 5a–5j | see below |
| `game.css` | 0, 3a, 4a–4l, 5 | the look of each screen, in the same order as the page; rules are never reordered (the cascade) |

### `game.js`, block by block

| Block | Functions |
|---|---|
| 0 Settings and state | `MEDIA_ONLINE` / `MEDIA_BASE` (where the films are: R2 online, `media/` on localhost), `CHARTS`, `MODEL_INPUTS`, timings (`THINK_MS`, `SUSPENSE`…), `KEYS`, `SHORT`, `state` |
| 1 Data | `media()` (a galaxy's file address); `played` / `found` and `rememberPlayed()` (the browser's memory) |
| 2 Data processing | `findBox()`, `pickGalaxy()`, `tertiles()`, `litMask()`, `countFitting()`, `lookbackOf()`, `agoAt()` |
| 4a Screens | `go()`, `leaveScreen()`, `fitSky()` |
| 4b Choosing | the rolling counter (`showCount()`, `odoRoll()`), `showQuestion()`, `answer()`, `markPlayable()`, `openChoose()` |
| 4c The film | `playClip()`, `preloadClip()`, the handoff (`startHandoff()`, `commitHandoff()`), `updateLabels()`, `tick()`, `startRound()`, `onEnded()`, `makeGuess()` |
| 4d Suspense and gauge | `startFuture()`, `swingNeedle()`, `landNeedle()`, `checkSlow()`, `finale()`, `endSuspense()` |
| 4e Verdict | `revealTruth()`, `backToSky()`, `fillSee3d()` |
| 4f Remarkable galaxies | `openShowcase()`, `openMeet()`, `morph()`, `startShowcase()`, `startFilm()`, `buildHomeCards()`, `homeMarks()`, `thumbOf()` |
| 4g Full screen | `toggleFull()`, `togglePageFull()`, `fullChanged()` |
| 4h 3D view | `setupSteps()`, `cloudOf()`, `where()`, `render3d()`, `tick3d()`, `open3d()`, `wire3d()` |
| 4i Opening | `heroOf()`, `describeHero()`, `dezoomFrames()`, `playIntro()` |
| 6 Wiring | `init()` |

### `sound.js`

`sound.js` never calls `game.js`: it only watches the page (`<body data-screen / data-mode / data-galaxy>`, the
`#finale` layer, the film element) and reads `window.gameScore` (each galaxy's numbers, set in `init()`).

| Sub-block | What it does | Main names |
|---|---|---|
| 5a Settings | the tracks and their loudness, the fade times | `TRACKS`, `BOSS`, `FADE_IN`, `CROSS`, `LAP` |
| 5b State and memory | on/off and volume, kept in the browser | `on`, `volume`, `master`, `duck` |
| 5c Which track | the track for the screen shown, lower during the verdict | `scene()`, `filmOver()`, `level()` |
| 5d Track players | loading ahead, laps without a gap, crossfades | `prime()`, `makePlayer()`, `lap()`, `switchTo()` |
| 5e Adaptive boss music | Web Audio filters whose dials follow the galaxy's star formation and fuel; the drop on "Watch its life"; the boom, collapse and drone at the switch-off | `graph()`, `galaxyData()`, `dialsAt()`, `drop()`, `switchOff()`, `adapt()` |
| 5f The clock | 30 ticks a second: fades, laps, clean-up | `tick()`, `run()` |
| 5g Button and slider | turning the music on and off | `start()`, `stop()`, `show()`, `preloadAll()` (every sound loaded ahead) |
| 5h Following the game | a new screen -> a new track | `follow` (a `MutationObserver`), `restart()` (the music when a film ends) |
| 5i Small sounds | click, hover tick, bet, verdict, impact, boom | `SFX`, `loadSfx()`, `sfx()`, `tickOn()` |
| 5j Loading ahead | what loads before the music is on; `window.gameSound` for checks | `ready` |

## 4. The data files

**`data/game.json`** (written by `src/game_assets.py`):

- `snapshots` (72 … 84), `decision_snapshot` (78: the moment of the bet), `fps` (30), `timeline` (frames held and
  frames per snapshot in the films), `quenched_ssfr` (1e-11 per year: the "switched off" line), `threshold` (the
  model's decision line, about 0.32), `pool` (`n`, `quenched_share`).
- `boxes`: one per mix of answers: `size`, `gas`, `wind`, `place`, `n` galaxies, `n_quenched`, `quenched_share`,
  `keeper` (the most typical galaxy, its film plays), `quencher` (the most typical one that switched off), `galaxies`.
- `galaxies`: by id: `model_probability`, `quenched` (the truth), `is_central`, `map_x` / `map_y` (its point in the
  sky), `films` (which MP4s exist), `labels` (the numbers written over the film, frame by frame), `series` (one value
  per snapshot: `lookback`, `mstar`, `mgas`, `sfr`, `ssfr`, `bh_mass`, energies, `halo_mass`, `host_dist_*`…),
  `cloud_steps` (the 3D snapshots), `cloud_scale_kpc`.
- `showcase`: the three remarkable galaxies (`id`, `title`, `story`, `thumb`, `meet`); `hero`: the opening picture;
  `motion_ids`: galaxies whose films are of the "motion" style.

**`data/map.json`**: the sky. `fields` names the columns of each point in `points` (12,710 rows):
`x` (log stellar mass), `y` (log gas / stars), `chance` (the model's), `quenched`, `is_central`, `id`, `wind`, `box`;
`edges` gives the tertile cuts of the size and gas answers.

**`media/<id>/cloud_<snap>.bin`**: one 10-byte record per particle, little-endian: `int16 x, y, z` (position /
`cloud_scale_kpc` × 32767), `uint8 kind` (0 gas, 1 star), `uint8 value` (gas: star-formation class; star: age class),
`uint16 size` (in 0.01 kpc). Written by `cloud()` in `game_assets.py`, read by `build()` in `viewer3d.js`.

## 5. Where to change common things

- A word on screen: `index.html` (fixed text) or `game.js` block 0 (`SHORT`, `MODEL_INPUTS`) and block 4 (built text).
- A timing: `game.js` block 0 (`THINK_MS`, `SUSPENSE`, `MID_PAUSE_MS`); the counter: `ODO_MS`, `ADVANCE_MS` (4b).
- A colour: `game.css` block 0 (variables), `charts.js` `COLOURS`, `sky.js` settings.
- A music track or its loudness: `sound.js` block 5a (`TRACKS`, `BOSS`).
- Which galaxies play: `src/game_galaxies.py` (`pick()`), then `src/game_assets.py` to rebuild `game.json`.
