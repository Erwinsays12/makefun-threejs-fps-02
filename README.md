# DUSKLINE

A round-based tactical FPS in three.js, in the style Counter-Strike made
famous - two teams, short rounds, money between rounds, and gunfire
where accuracy counts more than speed. Everything is original: the map,
the teams, the weapon names, the sounds.

You lead the **Ember** attack squad (you plus VEX and MARA) against four
**Slate** defenders in the Foundry Yard, a derelict smelting yard at
dusk. Plant the bomb at site A or B, or eliminate the defence. The
defenders win by stopping you, running out the clock, or defusing.
First to 5 rounds, at most 9.

## Play it

```
node serve.ts          # then open http://localhost:8080 in Chrome
```

Static files only - any static server pointed at `game/` works too.

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Look (click the game to lock the pointer) |
| LMB / RMB | Fire / aim down sights |
| Shift | Walk - quiet and steadier |
| Ctrl or C | Crouch - the tightest spread |
| Space | Jump (and ruin your aim) |
| 1-4 | Buy during the buy phase |
| R | Reload |
| E (hold) | Plant the bomb inside a site |
| G | Throw a smoke grenade |
| Tab | Scoreboard |

## How a round works

- 8-second buy phase: pistol free, Kestrel SMG $1100, Longbow Rifle
  $2700, Kevlar $650, smoke grenade $300. Start cash $800.
- Kills pay $300, a round win $3250, a loss $1900 (plus $800 if your
  bomb was planted). Dying loses your primary weapon.
- The bomb carrier is drawn at random each round - sometimes it is you.
  Planting takes 3 s inside a site; the bomb ticks for 40 s; a defuse
  takes 5 s. Smoke blocks bot vision and swallows bullets.
- Spread punishes motion: run < walk < stand < crouch < ADS. Headshots
  multiply damage; Kevlar cuts every hit to 55%.

## The map

The Foundry Yard (48 m x 36 m): three lanes west to east - north lane,
a mid broken around the old smelter block, south lane - two plant sites
against the east wall, hand-placed cover, painted lane markings, site
signs, gantry lamps and a low ember sun.

## Code layout

The simulation is fixed-step (60 Hz) and kept apart from rendering.

- `game/src/main.js` - bootstrap, camera/recoil, viewmodel, effects, loop
- `game/src/match.js` - phases, rounds, bomb, economy, damage
- `game/src/world.js` - the map: meshes, colliders, raycasts, waypoint graph
- `game/src/bots.js` - bot bodies, senses (vision cone + hearing), tactics
- `game/src/player.js` - movement and stance for the human fighter
- `game/src/weapons.js` - weapon table, gun state, the hitscan solver
- `game/src/grenade.js` - smoke ballistics and the vision-blocking cloud
- `game/src/hud.js` / `input.js` / `audio.js` - DOM HUD, raw input, synth sound
- `game/src/rng.js` / `palette.js` - seeded randomness, the dusk palette
- `vendor/makefun-threejs.ts` - the kit's dossier library, unchanged
- `main.ts` - hands the entry in: copies `game/` + `screenshots/` to the
  output directory and writes `dossier.json`

## Hand-in check

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots are real renders of the staged scenes in `shots.json`
(`game/index.html?shot=play&seed=1` and friends), taken in headless
Chrome at 1280x720 and saved as JPEG.
