# SALTFIRE — Pirate Empire

A 3D pirate empire strategy + naval action game that runs in the browser (WebGL / Three.js) with
peer-to-peer multiplayer over WebRTC. **Play: https://fanaustinca.github.io/saltfire/**

## Features
- **Ocean & ships** — Gerstner-wave ocean with foam, sky reflections, sun glint and shoreline surf. Ships ride the
  same wave field the GPU draws (heave, pitch, roll, heel, recoil). Six procedurally built, period-styled hulls
  (Sloop, Schooner, Brigantine, Frigate, Galleon, Man of War): planked lofted hulls, painted wales, gun decks with
  open ports and run-out cannons, stern galleries, tapered masts with tops, square/gaff/lateen/jib sails that
  billow and tear, shrouds with ratlines, waving flags.
- **3rd-person helm + visual targeting** — the mouse shows the firing sector on the aimed side and a 3D trajectory
  arc to the exact landing point: green = valid (bright when over a ship), yellow = reloading, red = out of range,
  outside the arc, blocked by land or inside a safe haven. Edge-look swings the camera over the aimed broadside.
- **Crew** — crew losses slow reloads and steering. Grapeshot kills crew, chainshot shreds sails, explosive shot
  sets ships ablaze.
- **Progression** — XP and levels give upgrade points: bow/stern chasers, extra broadside guns, speed, hull, turn,
  reload. Ship tiers with exactly 1/1/2/3/5/10 cannons per side.
- **Crafting** — chainshot, grapeshot, explosive shot and gunpowder from oak, iron, canvas and powder.
- **Custom shipyards** — build custom-sized ships with custom cannon counts (within tier limits), name them, paint
  hull/trim/sails and pick a flag, with a live 3D preview.
- **Empire** — every new captain gets an island; docks, shipyards, watchtowers, mills, mines, sail lofts, powder
  houses, warehouses, positionable shore cannons and sea forts all appear on the island, which grows as you build.
  Pirate holds and other players' bases can be raided and conquered (destroy the keep, hold position).
- **World** — level-matched AI merchants, pirates and navy patrols; random world events: the **Kraken**, guarded
  **Treasure Flagships** and pirate raids on bases.
- **Economy & diplomacy** — player market with instant buys/sells, limit buy/sell orders, ship listings and a 5%
  transaction tax; safe havens, alliance access lists, entry fees, remote treaties (peace / trade / alliance / war).
- **Multiplayer** — the host's browser generates a 6-digit room code; friends join with it. The host's browser
  saves the world and every captain (IndexedDB, keyed by unique player IDs); returning players rejoin with their
  empire. Offline captains' bases are shielded while neutral trading continues.

## Controls
`W`/`S` sails · `A`/`D` steer · mouse aim · click / `Space` fire · `1`–`4` / `Q` ammo · `E` dock / claim / port ·
hold `F` harvest · `M` map · right-drag orbit · wheel zoom · `C` reset camera · `H` help · `Esc` menu.

## Dev console
Open the browser console and run `dev.help()`, or press `` ` `` in game for a command prompt
(`kraken`, `give all 500`, `ship galleon`, `spawn pirate frigate 3`, `event treasure`, `tp port`, `sea 1.4`, …).

## Development
```bash
npm install
npm run dev          # http://localhost:8963
npm test             # build + logic tests + headless browser (Puppeteer) e2e
node tests/shot.mjs "auto=solo&seed=42" out.png   # screenshot any scenario (GPU=1 for the real GPU)
```
URL hooks for testing: `?auto=solo|host|join&code=NNNNNN&pid=X&name=Y&seed=N`, `?net=local` (multiplayer between
tabs without WebRTC), `?gallery=all|frigate&cam=side|quarter|front|back` (ship model gallery).

The e2e suite renders the canvas headlessly, inspects pixels, plays with real keyboard/mouse input, runs a two-tab
multiplayer session and saves screenshots to `tests/screenshots/` (uploaded as a CI artifact).
