# Music credits

Six tracks, one for each part of the game (sound.js picks the track from the screen, and crossfades on a change).
All are CC0 1.0 (public domain dedication), https://creativecommons.org/publicdomain/zero/1.0/, and all come from
OpenGameArt. Each was re-encoded to mp3 with its metadata removed, and its loudness evened out to about -15 LUFS
(Cosmic Navigation about -17 LUFS, as more gain would clip its peaks).

| Part of the game | File | Track |
|---|---|---|
| Home and the list of the three | `cosmic-navigation.mp3` | "Cosmic Navigation" by Synth-thetic |
| Choosing and betting on a galaxy | `space-echo.mp3` | "Space Echo" by Centurion_of_war |
| The film of the simulation (and its verdict and 3D) | `film-gravity-turn.mp3` | "Gravity Turn" (action version) by vitalezzz |
| Boss: the star factory (395850) | `boss-star-factory.mp3` | "Space Boss Battle" by MintoDog |
| Boss: the fastest shutdown (269639) | `boss-fastest-shutdown.mp3` | "Determined Pursuit" by Emma_MA |
| Boss: the jellyfish (224668) | `boss-stripped-galaxy.mp3` | "Chase" by Wolfgang_ |

## Why each track has its part

Rules from game-audio writing, and how each track meets them. Tempo, density (sound onsets per second) and
brightness (median spectral centroid) were measured on the files.

| Track | Tempo | Density | Brightness | Length |
|---|---|---|---|---|
| Outer Space Loop | ~70 bpm | 2.0 /s | 710 Hz | 68 s |
| Space Echo | ~99 bpm | 1.3 /s | 630 Hz | 38 s |
| Cosmic Navigation | ~117 bpm | 3.3 /s | 510 Hz | 154 s |
| Space Boss Battle | ~172 bpm | 2.6 /s | 1370 Hz | 104 s |
| Determined Pursuit | ~161 bpm | 3.1 /s | 1280 Hz | 108 s |
| Chase | ~152 bpm | 2.7 /s | 1100 Hz | 77 s |

After listening, the student chose differently for two parts: the home plays Cosmic Navigation, and the film (with
its verdict and 3D view) plays Gravity Turn, a more driving track. Outer Space Loop is no longer used. The notes
below give the first reasoning, before those choices.

- **Home: Outer Space Loop.** A menu sets the game's mood and leads into play at a middle energy, between the calm
  choice and the fast bosses; visits to the home are short, so a 68 s loop is enough.
  Sources: [Adaptive audio in menus](https://www.gamedeveloper.com/game-platforms/adaptive-audio-in-menus-game-development-s-untapped-opportunity),
  [Modular music for Lineage M (GDC 2022)](https://www.gamedeveloper.com/game-platforms/segmentation-for-modular-game-music-composing-for-lineage-m-gdc-2022-).
- **Choosing and betting: Space Echo.** A decision screen wants slow, sparse, steady music that helps the player
  concentrate. Space Echo is the sparsest and the steadiest of the six (1.3 onsets/s, 4.4 dB of loudness range).
  Its weak point is a short loop (38 s), so it may wear if a player lingers.
  Source: [Winifred Phillips, the music of Dragon Front](https://www.gamedeveloper.com/audio/video-game-composers-can-make-you-smarter-the-music-of-dragon-front-part-1).
- **The film: Cosmic Navigation.** Cinematic, slowly building scenes are watched again (replays, 3D), and the
  longest loop (154 s) hides the repetition best; the verdict dip in sound.js leaves room for the suspense.
  Sources: [Rethinking the audio loop](https://gamedeveloper.com/audio/rethinking-the-audio-loop-in-games),
  [Semi-silence for suspense](https://gamedeveloper.com/audio/composing-video-game-music-to-build-suspense-part-5-semi-silence).
- **Bosses.** Boss music raises tempo and intensity for adrenaline and stands apart from the rest of the score. The
  three boss tracks are the three fastest (150 to 170 bpm) and the three brightest of the six.
  Sources: [Game music that fits: boss music](https://www.gamedeveloper.com/audio/getting-making-game-music-that-fits-classic-genre-series-boss-music),
  [Ostinato and repetition](https://pillowmath.github.io/musings/ostinato-repetition.html).
  - **The star factory: Space Boss Battle.** The fastest and brightest: explosive, relentless creation.
  - **The fastest shutdown: Determined Pursuit.** An epic orchestra with frantic strings and the widest swings in
    loudness of the three bosses: a dramatic collapse.
  - **The jellyfish: Chase.** A synth chase, the darkest-sounding of the three bosses: an eerie plunge.
- **Mixing.** Music is lowered under what matters (the verdict dip), and switches with a short crossfade.
  Sources: [Notes from the mix: Prototype 2](https://gamedeveloper.com/audio/notes-from-the-mix-i-prototype-2-i-),
  [Reducing music fatigue](https://world.hey.com/thome/game-101-reducing-music-fatigue-d0214e31).

## Sources

**film-gravity-turn.mp3**: "Gravity Turn" (action version) by vitalezzz. Driving electronic music, 130 bpm.

- Source: https://opengameart.org/content/gravity-turn
- Original file: https://opengameart.org/sites/default/files/gravity_turn_action.wav
- Changes: bars 16 to 96 of the 176 kept (the piece plays this part twice, so bar 96 flows back into bar 16),
  the 250 ms after bar 96 blended into bar 16, 80 kbps mp3, -2.8 dB (about 148 s, 1.48 MB).

**space-echo.mp3**: "Space Echo" by Centurion_of_war.

- Source: https://opengameart.org/content/space-echo
- Original file: https://opengameart.org/sites/default/files/space_echo.ogg
- Changes: ogg to 112 kbps mp3, loudness normalised (about 38 s, 0.54 MB).

**cosmic-navigation.mp3**: "Cosmic Navigation" by Synth-thetic (the looping version).

- Source: https://opengameart.org/content/cosmic-navigation
- Original file: https://opengameart.org/sites/default/files/cosmic_navigation_loop.flac
- Changes: flac to 80 kbps mp3, +3.8 dB (about 154 s, 1.54 MB).

**boss-star-factory.mp3**: "Space Boss Battle" by MintoDog (175 bpm, made to loop).

- Source: https://opengameart.org/content/space-boss-battle
- Original file: https://opengameart.org/sites/default/files/space_boss_battle_bpm175.mp3
- Changes: 320 kbps to 96 kbps mp3, -3.2 dB (about 104 s, 1.25 MB).

**boss-fastest-shutdown.mp3**: "Determined Pursuit (epic orchestra loop)" by Emma_MA.

- Source: https://opengameart.org/content/determined-pursuit-epic-orchestra-loop
- Original file: https://opengameart.org/sites/default/files/determined_pursuit_loop.wav
- Changes: wav to 96 kbps mp3, -2.0 dB (about 108 s, 1.30 MB).

**boss-stripped-galaxy.mp3**: "Chase" by Wolfgang_.

- Source: https://opengameart.org/content/chase
- Original file: https://opengameart.org/sites/default/files/Chase.ogg
- Changes: ogg to 112 kbps mp3, -2.0 dB (about 77 s, 1.08 MB).

## Interface sounds (sfx/)

All CC0 1.0, by Kenney (www.kenney.nl), from OpenGameArt. Each was cut to start right on the sound, its tail faded
out, made mono, levelled well under the music (peaks at -6 to -12 dBFS; the verdict stings reach about -21 LUFS
momentary, the others less), and saved as 96 kbps mp3.

| File | Use | Length | Original |
|---|---|---|---|
| `sfx/ui-click.mp3` | buttons, answer choices, cards | 20 ms | `tick_002.ogg`, Interface Sounds |
| `sfx/ui-click.mp3`, played 1.6 times faster (higher) and about 12 dB softer | the pointer or the keyboard moving onto a button, a card, an answer or a remarkable galaxy on the map | 13 ms | the same `tick_002.ogg` (no extra file) |
| `sfx/ui-start.mp3` | Start, "Watch its life" | 284 ms | `confirmation_001.ogg` (two rising notes), Interface Sounds |
| `sfx/bet-lock.mp3` | the bet is placed | 120 ms | `bong_001.ogg` (a low bong), Interface Sounds |
| `sfx/verdict-off.mp3` | "It switched off" | 0.99 s | `jingles_PIZZA01.ogg` (pizzicato strings, falling), Music Jingles |
| `sfx/verdict-on.mp3` | "It kept making stars" | 0.95 s | `jingles_PIZZA02.ogg` (the same strings, rising), Music Jingles |

- Interface Sounds: https://opengameart.org/content/interface-sounds (file `kenney_interfaceSounds.zip`)
- Music Jingles: https://opengameart.org/content/85-short-music-jingles (file `jingleSounds_Kenney.zip`)

## Sounds for the remarkable galaxies (sfx/)

All CC0 1.0, from OpenGameArt; built from these sources, mono mp3, levelled under the music.

| File | Use | Length | Level | Made from |
|---|---|---|---|---|
| `sfx/watch-impact.mp3` | the film starts | 1.2 s | about -20 LUFS momentary | `explosionCrunch_001` reversed into a rising swell, then `impactMetal_001` (Kenney, Sci-Fi Sounds) |
| `sfx/shutdown-boom.mp3` | the galaxy switches off | 1.7 s | about -18 LUFS momentary | `lowFrequency_explosion_000` (Kenney, Sci-Fi Sounds) |
| `sfx/dark-drone.mp3` | after the shutdown, looping | 17 s | about -24 LUFS | the five `spaceEngineLow` rumbles (Kenney, Sci-Fi Sounds), chained with 1 s crossfades, low-passed at 500 Hz, the last second blended into the first so it loops |
| `sfx/fade-air.mp3` | the jellyfish switches off | 1.4 s | about -20 LUFS momentary | 1.4 s of "Space Winds" (aquinn), its pitch gliding down as it swells and fades |

- Kenney, Sci-Fi Sounds: https://opengameart.org/content/sci-fi-sounds (file `sci-fi_sounds.zip`)
- aquinn, Space Winds: https://opengameart.org/content/space-winds (file `space-wind_0.mp3`)
