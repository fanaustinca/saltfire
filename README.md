# SALTFIRE — Pirate Empire

A 3D pirate empire strategy + naval action game that runs in the browser (WebGL / Three.js) with
peer-to-peer multiplayer over WebRTC. **Play: https://fanaustinca.github.io/saltfire/**

## Features
- **Ocean & ships** — Gerstner-wave ocean with foam, sky reflections, sun glint and shoreline surf. Ships ride the
  same wave field the GPU draws (heave, pitch, roll, heel, recoil); the sea calms in the lee of islands. Seven
  distinct procedural designs: a plain little single-masted **Sloop**, a two-masted all-gaff **Schooner**, a square-fore
  **Brigantine** with quarterdeck, a black-and-ochre full-rigged **Frigate**, a **Galleon** with a towering painted
  stern castle, beakhead and lateen mizzens, and a three-decked **Man of War** with triple stern galleries, studding
  sails, gilt lion figurehead and up to 20 guns a side. Two giants sit above it, both hugely expensive: the royal-blue
  **Sovereign**, a four-decked first rate with a gilded crowned stern (18–34 guns a side), and the flagship-only **Leviathan**, a
  broad 116 m five-decked ironclad: armoured belt, iron ram, pivot guns, carronade-lined spar deck, an armoured
  overhanging stern of lit galleries above an iron belt of chase guns, quarter galleries and a glowing-eyed skull, and four masts
  with five tiers of sail.
- **Titan** — a 150 m black-sailed six-decker (120 guns a side, 150 above 100% size) that cannot be bought: win it as
  a reward card on the Wheel of Fortune (0.1%) or by claiming every day of the Holiday Tides event. Dev: `titan`.
- **Rewards (`J`)** — Wheel of Fortune: one free spin a day, more for 20,000 gold (Titan 0.1%, Leviathan 0.5%,
  Sovereign 0.7%, Man of War 1%, Galleon 2%, Titan Size card 0.2%, plus gold and supplies). **Holiday Tides**
  (9 Nov – 1 Jan): a gift every day; claim every single day for a Titan card on New Year's Day, a Titan Size card
  on Christmas. Won ships are **reward cards** — redeem at any Shipwright or pay with them in the custom shipyard.
- **Battle damage** — shot holes appear exactly where balls strike, hulls char and smoulder, damaged ships settle
  and list, sails tear and topmasts get shot away.
- **3rd-person helm + visual targeting** — the mouse shows the firing sector on the aimed side and a 3D trajectory
  arc to the exact landing point: green = valid (bright when over a ship), yellow = reloading, red = out of range,
  outside the arc, blocked by land or inside a safe haven. Edge-look swings the camera over the aimed broadside.
- **Crew** — crew losses slow reloads and steering. Grapeshot kills crew, chainshot shreds sails, explosive shot
  sets ships ablaze.
- **Progression** — 200 levels and ~240 upgrade ranks across 17 upgrades (broadside guns, chasers, firing rate,
  range, damage, accuracy, speed, turning, sails, hull, armour, crew, at-sea repairs, foraging, plunder, fleet size).
  Ship tiers start at 1/1/2/3/5/10/16/30 cannons per side. The most a hull can carry grows with its size
  (85%–120% in your shipyard): a Man of War carries 20 at full size, a Sovereign 18 at 85% and 34 at 120%, a
  Leviathan 30 at 85% and 60 at 120%.
- **Repairs at sea** — `R` sends your carpenters to patch the hull (and some canvas) with oak from your hold and put
  out fires, even mid-battle (short cooldown).
- **Wake trails** — buy coloured trails with gold (Wake Trails tab in any port): gilded, ember, blood tide, emerald,
  azure, ghost violet, phantom mist, rainbow.
- **Fleets** — every ship you own beyond your flagship can be sent out (`G`, or click an island on the map) to
  escort you, guard an island, or attack an enemy/clan/wild island — they bombard it and capture it for you.
- **Crafting** — chainshot, grapeshot, explosive shot and gunpowder from oak, iron, canvas and powder.
- **Custom shipyards** — at the Free Port or any of your islands (a Shipyard takes 20% off), build custom-sized ships with custom cannon counts (within tier limits), name them, paint
  hull/trim/sails and pick a flag, with a live 3D preview.
- **Empire** — a big sea (12 km across) with ~70 claimable pirate-cove islands: sheltered bays with docks and stilt
  huts, sea cliffs, hills, rivers carved into the ground running down to the cove (and waterfalls off the cliffs),
  worn footpaths between your buildings, meadows, forests, flowers, boulders, lighthouses,
  vegetable plots, rowboats, careened ships and a timber Captain's Lodge with a crow's-nest lookout; long jetties
  sized for your flagship. Wild islands are held by squatters
  (stronger further out) — beat them and pay a colony charter that grows with every island you hold. Docks,
  shipyards, watchtowers, mills, mines, lofts, powder houses, warehouses, shore cannons and sea forts appear on the
  island as you build, and the island itself grows much larger with each one (it never grows into a neighbour).
- **Pirate clans** — eight clans hold fortresses (skull rocks included). They fortify them over time, buying what
  they lack on the market and selling surplus, patrol their waters, raid wild islands, rival clans and players, and
  can be conquered (smash the keep, sink the defenders, hold position). Broken clans rise again elsewhere.
- **World** — busy seas: lots of small fry plus level-matched heavies (up to your own tier); pirates prey on
  merchants and each other, the navy hunts pirates, merchants run cargo to the Free Port for the Merchant Guild.
  Random events: the **Kraken**, guarded **Treasure Flagships** and clan raids.
- **Economy & diplomacy** — player market with instant buys/sells, limit buy/sell orders, ship listings and a 5%
  transaction tax; safe havens, alliance access lists, entry fees, remote treaties (peace / trade / alliance / war).
- **Multiplayer** — the host's browser generates a 6-digit room code; friends join with it. The host's browser
  saves the world and every captain (IndexedDB, keyed by unique player IDs); returning players rejoin with their
  empire. Offline captains' bases are shielded while neutral trading continues.

## Controls
`W`/`S` sails · `A`/`D` steer · mouse aim · click / `Space` fire · `1`–`4` / `Q` ammo · `E` dock / claim / port ·
hold `F` harvest · `R` repair at sea · `M` map · `G` fleet command (side drawer at sea) · right-drag orbit · wheel zoom · `C` reset camera · `H` help · `Esc` menu.

## Dev console
Open the browser console and run `dev.help()`, or press `` ` `` in game for a command prompt
(`kraken`, `give all 500`, `ship manowar`, `fleet frigate 3`, `clans`, `raid`, `spawn pirate frigate 3`,
`event treasure`, `tp port`, `sea 1.4`, `unlock`, …).

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
