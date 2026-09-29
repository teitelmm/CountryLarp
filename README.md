# CountryLarp

A top-down 3D grand-strategy game, in the spirit of *Cities: Skylines* meets *Hearts of Iron 4*: pick a **real country**, build its infrastructure and war economy on **real terrain**, and (in later phases) raise an army and keep it supplied.

**This is Phase 1: the building system.** Economy simulation, armies, unit control and supply lines are not built yet; the data model leaves hooks for them (see [Future hooks](#future-hooks)).

Runs in the browser: three.js + TypeScript + Vite, with [Rapier](https://rapier.rs) for rigid-body physics.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173  ->  pick a country
```

Useful URLs: `/?country=POL` skips the picker, add `&fresh=1` to ignore a saved game. `/?sheet` is a dev contact-sheet of every building.

```bash
npm test             # 188 unit tests (headless: real Rapier physics runs in Node)
npm run typecheck
npm run build && npm run preview
```

## Playing

Choose a nation, open a category in the build bar, pick a building, and click to place it. A translucent **ghost** follows the cursor, snapped to a grid and tinted green (valid) or red (invalid). The tooltip lists *every* reason a site is refused. Placing starts construction:

1. **Sizing** – the blueprint volume springs up to full size while the ground is graded flat under it.
2. **Building** – a tower crane swings to each piece and releases it. Pieces are rigid bodies steered into place (collisions on, so they bump and settle) and welded exactly. Scaffolding rises with progress and dust puffs where pieces land.
3. **Finishing** – squash-and-settle, the scaffold is stripped and tumbles away, the crane folds up, and the model is merged into a few static meshes.

Click a finished building to **inspect** it; **Demolish** (press twice to confirm, refunds half the cost) and the building comes apart into rigid-body rubble.

### Controls

| | |
|---|---|
| **Pan** | `W A S D` / arrows / push the mouse to a screen edge (`Shift` = fast), or **middle-drag** to grab the ground |
| **Rotate / tilt** | `Q` `E` rotate · **right-drag** orbits and tilts · `PageUp` `PageDown` tilt |
| **Zoom** | mouse wheel, towards the cursor |
| **Reset view** | `Home` |
| **Build** | click a card (or `1`–`6` for the card in the open category, `[` `]` to change category) |
| **While placing** | left-click place · `Shift`+click keep placing · `R` / `Shift+R` rotate 90° · `Alt`+wheel fine rotate · `Esc` / right-click cancel |
| **Select** | click a building · `Esc` / right-click empty ground deselects · `Delete` (twice) demolishes |
| **Time** | `Space` pause · `+` `-` speed · buttons in the top bar (1×, 2×, 3×) |
| **Supply ports** | `P` toggles the overlay of each building's 3D supply anchors |

Zoom out and every building gets a constant-size map marker, so the country stays readable at strategic scale. The game **autosaves** to your browser (`localStorage`) and resumes, including buildings that were mid-construction.

## Buildings (18)

| Category | Building | Cost | Build time | Notes |
|---|---|---:|---:|---|
| Medical | Hospital | 250 | 24 s | rooftop helipad |
| | Field Hospital *(war)* | 60 | 8 s | tented, quick, tolerates rough ground |
| Industry | Civilian Factory | 300 | 28 s | sawtooth roof |
| | War Factory *(war)* | 450 | 36 s | tank yard |
| | Power Plant | 400 | 36 s | twin cooling towers |
| | Oil Refinery | 500 | 42 s | tanks, towers, flare stack |
| Civic | Housing Block | 150 | 18 s | |
| | Farm Complex | 120 | 16 s | |
| | University | 350 | 30 s | |
| | National Monument | 200 | 28 s | landmark |
| Military | Barracks *(war)* | 180 | 18 s | |
| | Military Academy *(war)* | 380 | 30 s | |
| | Airfield *(war)* | 600 | 48 s | 12 km runway; needs very flat ground |
| | Naval Base *(war)* | 700 | 54 s | **coastal**: drydock and gantry |
| | Radar Station *(war)* | 250 | 22 s | tolerates slopes |
| | Fortress *(war)* | 350 | 34 s | tolerates steep ground |
| Logistics | Supply Depot *(war)* | 220 | 22 s | road, rail and air ports |
| | Port | 650 | 54 s | **coastal**: quay, cranes, containers |

Costs come from a **stub treasury** (starting balance 6,000). There is no income yet.

### Placement rules

A site must be inside your borders (an exact point-in-polygon test), on land, not too steep (each building has its own limit, measured as drawn), clear of other buildings (oriented-rectangle overlap with a small gap), and not need excessive earthworks. **Coastal** buildings auto-rotate to face the sea and may extend into territorial waters. Terrain under a building is graded flat, and its edge blends smoothly into the surroundings. Slope is judged on the *original* land, so an earlier building's graded pad never blocks you from building next to it. Buildings close enough for their pads to interact **share one level** (a settlement is terraced flat); if two neighbours are at different levels, the gap between them is refused ("Neighbouring buildings are at different levels").

## How it works

```
scripts/            data baker + e2e/smoke scripts
public/data/        baked countries (PNG data image + JSON per country)
src/
  core/             input, fixed-step game clock, save format, treasury, OBB geometry, spatial hash
  world/            country data, HeightField (CPU terrain), chunked LOD terrain, water, borders, sky, territory
  camera/           RTS camera
  buildings/        catalog + recipes, placement & validation, construction, demolition, selection, markers
  physics/          Rapier world
  fx/               dust particles, spring/easing
  ui/               build bar, top bar, inspect panel, clock controls, tooltips, icon renderer
tests/              unit tests (Vitest)
```

**Scale.** 1 world unit = 1 km, and vertical relief is exaggerated ×6 (`CONFIG.heightExaggeration`); real relief at this scale would look flat. Buildings are deliberately oversized (a hospital is 3.6 × 2.6 km) so they stay readable.

**Real terrain.** `npm run bake -- POL DEU …` downloads [Natural Earth](https://www.naturalearthdata.com/) borders and [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium) elevation, reprojects onto a local metric grid, rasterises the border mask, removes isolated elevation spikes, and writes one PNG + JSON per country. Six are committed (Poland, Germany, France, United Kingdom, Italy, Ukraine); baked areas match reality within ~0.5% (the UK is ~4% off from the single-parallel projection). Edit `scripts/countries.config.mjs` to add a bounding box (to drop overseas territories) or flag colours. Ukraine uses Natural Earth's point-of-view file so its map follows internationally recognised borders.

**Terrain rendering.** Heights live in a float texture; a shared set of LOD grids is displaced in the vertex shader with bicubic (Catmull-Rom) sampling that matches `HeightField.sample` on the CPU exactly. Editing terrain (grading a pad) is a small partial texture upload, not a mesh rebuild.

**Buildings are data.** Each `BuildingDef` (`src/buildings/recipes/*`) lists its footprint, cost, build time, placement rules, effects, supply **ports**, and a *recipe* of pieces (box / cylinder / cone / frustum / wedge, each with a construction stage) built with a small DSL. Tests check every recipe for footprint containment, overlapping pieces, contiguous stages and port bounds.

**Construction physics.** `ConstructionSite` steers each piece with a PD controller using computed torque (Rapier's world-space inertia tensor), welding it in place when it arrives or at a deadline. Tests prove the controller does the work (≥80% of pieces of every building arrive under their own steering; the deadline is only a safety net). To keep frame time bounded, sites far from the camera, or beyond `CONFIG.maxPhysicsBodies` simulated bodies, use an equivalent tween path with no rigid bodies. The simulation advances in fixed 1/60 s game-time steps (`Game.simulate`), independent of rendering, so it is deterministic and pausable.

## Testing

`npm test` runs everything headless, including full construction and demolition of every catalog building in real Rapier, a 40-building stress test, and pure-logic tests for validation, terrain, camera math, saves and the baker.

The Playwright scripts drive the real UI in headless Chromium. Start `npm run dev` first, then:

```bash
npm run e2e:camera         # pan / rotate / zoom-to-cursor / edge scroll with real input
npm run e2e:placement      # menu, ghost, validation reasons, coastal port, funds
npm run e2e:construction   # captures each construction stage (e2e-out/*.png); optional building id argument
npm run e2e:features       # select / inspect / demolish / autosave + resume / markers / ports overlay
npm run smoke:prod         # against `npm run preview` (the production bundle)
```

Headless Chromium uses software WebGL, which renders only a few frames per second, so these scripts wait on frame counts and fast-forward game time with `__game.advance(seconds)`.

## Known limitations

- **Water** is elevation ≤ 0 outside the border (inside it, sub-sea-level land such as polders is lifted to land). Lakes appear as flat land, because the elevation data gives lake surfaces a positive height.
- **Land cover** (forest / farmland patches) is procedural noise, not real data.
- Terrain at ~0.5–1.3 km per sample is coarse next to building scale; bicubic sampling and detail shading hide most of it.
- Huge countries (Russia, the USA) need a bounding box in the config to bake sensibly.
- Performance was verified headless and with software rendering only; real-GPU frame rates are untested.

## Future hooks

- `ports` on each building are 3D anchors typed ground / rail / sea / air / pipeline / power. The `P` overlay draws them; a supply-line phase can route splines between them over `HeightField` (bridges, tunnels, air-lift arcs, sea lanes).
- `HeightField.sample / normal / raycast` are what drag-to-move units and terrain-following supply arcs will need.
- `BuildingDef.effects` are declared but not yet consumed: that is where the economy and population needs attach.
