# Will it switch off?

A browser game about galaxies. Choose a kind of galaxy in a sky of 12,710 real galaxies from the IllustrisTNG
simulation (TNG100-1), watch its real past, bet on whether it will stop making stars, let a machine-learning model
bet too, then watch its real future.

The game is the public part of a master's capstone project on galaxy quenching: the data, the model and the scripts that render the films live in the capstone repository,
`galaxy-quenching-capstone`.

## What is here

| Path | What it is |
|---|---|
| `index.html`, `game.js`, `game.css` | the page and its screens |
| `sky.js`, `viewer3d.js`, `charts.js`, `sound.js` | the sky of galaxies, the 3D view, the live charts, the music |
| `data/game.json`, `data/map.json` | the galaxies, their boxes and facts, the sky map |
| `audio/` | music and sounds (all CC0, see `audio/CREDITS.md`) |
| `bg/` | the cosmic-web background, projected from the simulation |
| `vendor/` | three.js and its OrbitControls (MIT) |
| `CODE_GUIDE.md` | a map of the code, block by block |

The films, stills and 3D particle files (about 1.4 GB) are not in this repository. Online, the page reads them from
a Cloudflare R2 bucket (`MEDIA_ONLINE` in block 0 of `game.js`); on localhost it reads a local `media/` folder with
the same layout (`media/<galaxy id>/past_clean.mp4`, ...).

## Run it on your computer

Put the `media/` folder next to `index.html`, then serve the folder (any static server works):

```
python -m http.server 8772
```

and open http://localhost:8772/. To test the online films from localhost, add `?media=<bucket address>/`.

## Data

Simulation data: IllustrisTNG, TNG100-1 (Nelson et al. 2019, Pillepich et al. 2018), https://www.tng-project.org/.
