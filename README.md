# Frontier Painter

A puzzle-game prototype: you're a painter aboard a generation ship who wakes
early because of a software bug. The ship's reality is software-rendered, and the
bug is corrupting it — so you repair the ship the only way a painter can: you
**paint physical properties back onto broken surfaces**. Your palette isn't
colors, it's *physics* — paint a dead rail `cold` and it frosts into a grabbable
**handhold**, paint a dead conduit `conductive` and it re-powers a door. Each
broken surface takes exactly **one** correct property ("right property, right
place") — the puzzle is deducing which. **Magnetic boots** let you walk across
any surface — floor, walls, ceiling — and release to float and paint.

Built with **TypeScript + Vite + Babylon.js**. Movement uses Babylon's built-in
collisions (`mesh.moveWithCollisions` + ellipsoid) plus a **custom kinematic
zero-g controller** (velocity + damping, no gravity) and analytic magnetic-boots
surface walking. No external physics engine (Havok/Ammo/Cannon) yet — that is
deliberately deferred. The room is dressed procedurally as a clean utilitarian
(NASA/ISS-style) ship interior — no binary assets.

> Early prototype, built iteratively. A deterministic `window.game` automation
> API drives reproducible headless playthrough demos (see below).

## Controls

- **1 / 2 / 3** — select brush property: cold · conductive · magnetic
- **F** — paint the broken surface at the crosshair with the selected property
- **P** — switch room (Frost Gap ⇄ Cross-Wired Junction)
- **B** — toggle magnetic boots (plant / float). First-person while booted.
- **WASD** — walk + strafe (booted) / thrust (floating)
- **Mouse** — look (floating *and* booted). Vertical look is inverted (mouse up →
  look up). **Click the view to capture the cursor** so it can't leave the
  window; **Esc** releases it.
- **Space** — push off a surface (booted) / grab–release a handhold (floating)
- **Left-drag** (floating, first-person, cursor released) — draw a stroke (legacy
  handhold verb)
- **C** — toggle demo / first-person camera · **R** — reset

Headed play boots straight into the **Frost Gap** paint puzzle; press **P** to
switch to the **Cross-Wired Junction**. The palette + a per-surface repair
checklist show in the HUD; the console won't power until every broken surface is
repaired.

Two puzzle rooms exist so far:

- **The Frost Gap** — two *independent* surfaces: frost a dead rail (`cold`) into
  a handhold to cross, and make a conduit (`conductive`) to power the console.
- **The Cross-Wired Junction** — an *ordered chain*: the console core is hidden
  behind a coolant shroud. Frost the shroud (`cold`) to retract it and **reveal**
  the core, which you then make `conductive`. Painting the core before the shroud
  is repaired is rejected as inaccessible — "right property, right place, right
  **order**".

## Quick start

```bash
npm install
npm run dev        # Vite dev server
npm run build      # type-check + production bundle into dist/
npm run typecheck  # tsc, no emit
npm run test:e2e   # Playwright e2e
```

## Running playthrough demos

The playthrough harness produces the **official demo** of a slice: it builds the
app, serves the production bundle, drives the deterministic `window.game`
automation API through a scripted sequence of "beats", screenshots each beat,
records a video, and transcodes it to a small `demo.gif` + `demo.mp4`.

```bash
# Property-paint slice ("The Frost Gap") -> demos/frostgap/
npm run playthrough:paint

# Interaction slice ("The Cross-Wired Junction") -> demos/crosswire/
npm run playthrough:crosswire

# Magnetic-boots locomotion slice -> demos/latest/
npm run playthrough

# Generate a named/official demo into demos/<label>/
RUN_LABEL=slice-magboots npm run playthrough
#   ...also accepted as a positional arg:
npm run playthrough -- slice-magboots
```

There are two capture scripts, selected via the `CAPTURE_FILE` env that
`run.mjs` honors: `capture-paint.mjs` (the paint verb — arms the `frostgap`
scenario, demonstrates the *wrong-color* rejection, repairs the rail `cold`,
crosses to the **locked** console, powers it `conductive`, and wins) and
`capture.mjs` (the boots locomotion slice, which runs in the empty `"none"`
room). Both assert `goalReached === true` and a byte-identical determinism
replay, so each doubles as an end-to-end smoke test.

The current demo is the **magnetic-boots** slice: it plants the boots, walks
**floor → wall → ceiling** (filmed from the tracking `demo` camera, with one
first-person beat for the embodied feel), then pushes off into zero-g float,
draws a handhold, and pulls hand-over-hand to the goal to win. The 12 beats are:

1. `ready` — app loaded, framed from the `demo` camera, player floating at spawn.
2. `plant` — `setBoots(true)`: plant on the floor (`surfaceNormal ≈ [0,1,0]`).
3. `walk-floor` — `setFacing(0)` + `walk(1,0)`: walk across the floor.
4. `climb-wall` — keep walking off the +X edge onto `wallPosX` and climb up.
5. `ceiling` — cross the top edge onto the ceiling (`surfaceNormal ≈ [0,-1,0]`).
6. `first-person` — `setCameraMode("fp")`: embodied inverted view on the ceiling.
7. `pushoff` — `pushOff(3)`: detach into zero-g float (impulse along the normal).
8. `draw` — `drawStroke(...)`: freeze a handhold mid-air.
9. `approach` — `moveTo(...)`: free-float to within grab range of the tube start.
10. `grab` — `grab()`: latch the handhold.
11. `pull-win` — `pullAlong(...)`: pull to the goal → `goalReached === true`.
12. `replay` — re-run the boots traversal twice; surface-normal sequence +
    final position reproduce exactly (determinism).

What it does, end to end (`playthrough/run.mjs` orchestrates;
`playthrough/capture.mjs` drives + records):

1. `vite build` — fresh production bundle in `dist/`.
2. `vite preview` — serves `dist/` on `127.0.0.1:4173` (own process group,
   always torn down afterward).
3. Headless Chromium (Playwright, SwiftShader WebGL) loads the page and waits for
   `window.game.isReady()`.
4. Steps through the beats **via the API only** (no synthetic
   pointer/keyboard input), asserting expected state and capturing a labeled
   screenshot per beat, while recording a webm of the whole session.
5. `ffmpeg` transcodes the webm into `demo.mp4` (~720p, 15 fps) and `demo.gif`
   (~720px, 12 fps), sped up only as needed to fit a ~7.5 s budget.

The run **exits non-zero unless the player actually reaches the goal**, so it
doubles as an end-to-end smoke test.

### Where artifacts land

Everything is written under `demos/<RUN_LABEL>/` (the directory is wiped and
regenerated on each run, so the result is idempotent):

```
demos/<RUN_LABEL>/
  demo.gif            # animated overview
  demo.mp4            # h264 video
  frames/NN-<beat>.png  # one screenshot per beat, in order
  video/*.webm        # raw recording
  DEMO.md             # human-written narration of each beat (for official demos)
```

- `demos/latest/` is the convenience output of a bare `npm run playthrough`.
- Named runs (e.g. `demos/slice-01-handhold/`) are the official, documented
  demos kept alongside a `DEMO.md`.

The current official demo lives in
[`demos/slice-magboots/`](./demos/slice-magboots) — see
[`demos/slice-magboots/DEMO.md`](./demos/slice-magboots/DEMO.md). (The earlier
handhold-only demo is kept in [`demos/slice-01-handhold/`](./demos/slice-01-handhold).)

### Configuration (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `RUN_LABEL` | `latest` | Output subdirectory under `demos/`. |
| `HOST` | `127.0.0.1` | Preview host. |
| `PORT` | `4173` | Preview port. |
| `BASE_URL` | `http://$HOST:$PORT` | Target URL (set automatically by `run.mjs`; can point `capture.mjs` at an already-running server). |

### Extending the beat list as features ship

The beats are defined in `playthrough/capture.mjs`. Each beat is a small,
self-contained block that (1) calls one or more `window.game` methods, (2)
asserts the resulting `getState()`, and (3) captures a numbered frame. To add a
beat for a new feature:

1. **Add an automation method** if the feature needs one. The contract lives in
   `src/gameApi.ts` (`window.game`) with state shape in `src/types.ts` — keep it
   serializable (no Babylon objects across the Playwright boundary) and
   deterministic given identical inputs.
2. **Insert a new beat block** in `capture.mjs` in the desired order. Mirror the
   existing pattern:
   ```js
   // -- Bn: <name> -------------------------------------------------------
   const rN = await page.evaluate(() => {
     const g = window.game;
     /* drive the new feature ... */
     return g.getState();
   });
   assert(/* expected state */, "Bn: <reason>");
   log("Bn <name>:", /* short summary */);
   await shot("Bn-<name>");   // -> frames/NN-Bn-<name>.png (auto-numbered)
   ```
   Frame files are auto-numbered by capture order (`frameIndex`), so inserting a
   beat renumbers later frames automatically — just keep the `Bn-<name>` label
   meaningful.
3. **Keep the goal gate honest.** The run only passes when `goalReached === true`
   and the determinism replay reproduces the final position; preserve those
   assertions (the `pull-win` + `replay` beats) at the end so the demo stays a
   real smoke test.
4. **Document it.** Add a row to the beat table in the run's `DEMO.md` (and
   regenerate the demo) so the screenshots and narration stay in sync.

The render clip auto-fits its length: as the playthrough grows longer, the
ffmpeg speed-up factor increases to keep the clip under the
`TARGET_MAX_SECONDS` budget (it only ever speeds up, never slows down).
