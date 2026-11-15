# DUSKLINE — a three.js tactical FPS

A round-based tactical first-person shooter in the style Counter-Strike made famous,
built for make.fun's `threejs-fps-02` bounty. It runs entirely from static files in a
desktop browser: three.js 0.187.0, ES modules, no build step, no network.

## The game

Foundry Yard is an original 48 × 36 m industrial yard at dusk: three lanes (west,
mid, east) join two bomb sites — **A FOUNDRY** and **B SILO**. You are Vanguard,
attacking with two AI allies against four Raider defenders.

- **Rounds**: buy phase (8 s) → live round (100 s) → next round. First to 5 rounds
  wins the match (max 9). Win a round by eliminating the other team, by detonating
  a planted bomb, or by holding the yard when the clock runs out.
- **Objective**: hold **E** inside a site to plant the bomb (3 s). It blows in 40 s
  unless a Raider defuses it (5 s channel, broken by damage).
- **Economy**: start with $800. Kills pay $300, a round win $3,250, a loss $1,900,
  a plant $300. Spend it in the buy menu (**B**): K9 Hornet SMG ($1,500), VK-47
  Longshore rifle ($2,700), smoke grenades ($300), Kevlar vest ($650).
- **Gunplay**: hitscan weapons with headshots (×4 damage), recoil and spread that
  punish firing on the move, aim-down-sights (right mouse) that steadies the shot
  at the cost of speed, acceleration-based movement, crouching, jumping, and AABB
  collision with the map.
- **Bots**: allies and defenders walk a waypoint graph, hold positions, sweep their
  view, investigate gunfire they hear, strafe while shooting, and converge to
  defuse a planted bomb. Smoke blocks their line of sight exactly as it blocks
  yours.
- **Sound**: every effect is synthesised with WebAudio — no audio files.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click to lock) |
| Click | Fire |
| Right-click (hold) | Aim down sights |
| R | Reload |
| Ctrl / C | Crouch |
| Space | Jump |
| E (hold) | Plant the bomb at a site |
| G | Throw a smoke grenade |
| B | Buy menu (buy phase) |
| 1 / 2 / 3 | Pistol / SMG / Rifle |
| V | Buy Kevlar (buy phase) |

## Play it

```sh
node serve.ts   # then open http://localhost:8080
```

## Layout

- `game/` — the playable game (`index.html` + `src/*.js`, three.js vendored under `game/vendor/three/`)
- `screenshots/` — 4 screenshots taken from the game itself
- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged

## License

MIT — see `LICENSE`.
