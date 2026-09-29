# Frontier Painter

A puzzle-game prototype: you're a painter aboard a generation ship who wakes
early because of a software bug. The ship's reality is software-rendered, and the
bug is corrupting it — so you repair the ship the only way a painter can: you
**paint physical properties back onto broken surfaces**. Your palette isn't
colors, it's *physics* — paint a dead rail `cold` and it frosts into a grabbable
**handhold**, paint a dead conduit `conductive` and it re-powers a door. Each
broken surface takes exactly **one** correct property ("right property, right
place") — the puzzle is deducing which. **Magnetic boots** let you walk across
any surface — floor, walls, ceiling. Jumping with the boots on keeps you
magnetized: a hop comes back down on the surface you left, unless its arc
carries you closer to another surface — jump right beside a wall, or run at one
and jump, and you land on the wall. Turn the boots off to float free.

Built with **TypeScript + Vite + Babylon.js**. Movement is a **custom kinematic
zero-g controller** (velocity + damping, no gravity) with **analytic room
containment** (the player is clamped to the room box, so no wall can be leaked
through) and analytic magnetic-boots surface walking. Handholds are grabbed and
ridden, not collided with. No external physics engine (Havok/Ammo/Cannon) yet — that is
deliberately deferred. The room is dressed procedurally as a clean utilitarian
(NASA/ISS-style) ship interior — no binary assets.

> Early prototype, built iteratively. A deterministic `window.game` automation
> API drives reproducible headless playthrough demos (see below).

## Play it

**https://dnewcome.github.io/frontier-painter/** — rebuilt and redeployed on every
push to `main`.

- **On iPhone:** open the link in Safari, turn the phone sideways, then
  **Share → Add to Home Screen** to launch it fullscreen like an app.
- **On iPad:** same link, or the TestFlight build (universal iPhone + iPad app,
  landscape). The touch controls scale up for the larger screen.
- **On desktop:** same link; keyboard + mouse controls below.

## Touch controls (phone / tablet)

- **Left thumb** — floating joystick: thrust while floating, walk with boots on,
  pull hand-over-hand while holding a rail
- **Right thumb** — look stick (appears where you touch): small moves aim
  directly like a mouse (finger up → look up); push the knob to the ring's edge
  and hold to keep turning — the further out, the faster
- **PAINT** — walk or float up to a broken surface (within ~3.5 m): a PAINT
  marker appears over it and the action button turns into **PAINT**. Press it
  and **trace the property's glyph** with your finger — cold = spiral,
  conductive = lightning bolt, magnetic = horseshoe. Stray off the line or lift
  your finger and the stroke resets; finish it and the paint is applied.
- **Palette** (top-left) — cold · conductive · magnetic
- **BOOTS** / **GRAB·JUMP** (bottom-right) — mag boots on/off; grab a rail, or
  jump while booted
- **☰ menu** — restart room, optional **gyro look** (turn the phone to look
  around; needs the HTTPS link)

The phone HUD describes each broken surface by its **symptom** ("Overheated —
too hot to grip") rather than the answer — diagnosing the fix is the puzzle.

## Desktop controls

- **1 / 2 / 3** — select brush property: cold · conductive · magnetic
- **F** (or **Space**) near a broken surface — open the paint trace; drag the
  mouse along the glyph to apply the selected property (**Esc** cancels)
- **B** — toggle magnetic boots (plant / float). First-person while booted.
- **WASD** — walk + strafe (booted) / thrust (floating)
- **Mouse** — look (floating *and* booted). Vertical look is inverted (mouse up →
  look up). **Click the view to capture the cursor** so it can't leave the
  window; **Esc** releases it.
- **Space** — boots on: **jump** (stay magnetized, land on the nearest surface)
  / boots off: grab–release a handhold
- **Left-drag** (floating, first-person, cursor released) — draw a stroke (legacy
  handhold verb)
- **R** — reset the room

**Developer controls** (open the page with `?debug=1`): **P** skips to the
next room and **C** toggles the demo / first-person camera; the phone menu gains
the same two items.

Progress is saved: a fresh launch resumes the last room you entered (the phone
menu has **Replay tutorial**). `?room=<id>` starts in a given room
(`wakeup`, `handhold`, `boots`, `hop`, `frostgap`, `crosswire`). The palette + a per-surface repair
checklist show in the HUD; the console won't power until every broken surface is
repaired. The moment the last surface is fixed the room is **clear**: a ROOM
CLEAR banner flashes and the **exit door** in the far wall slides open and
lights up (pulsing green frame, glowing threshold, green light spilling into the
room), with an EXIT marker over it — or an arrow at the screen edge when it's
behind you. Float or walk through it to go to the next room. Each
room's wall stencils (sector, bay, EXIT → next sector) change with it.

The game opens with a **four-room tutorial**, one mechanic per room, each an
ordered list of steps with a coach prompt (worded for touch or desktop), a
glowing beacon showing where to go, and a ✓ + haptic tick as each step lands:

1. **Wake-Up Bay** — look at three blinking lights, then fly to two beacons.
2. **Handhold Run** — a ready-made rail: fly to it, GRAB, pull along, let go.
3. **Mag Boots** — fly up to the ceiling, BOOTS on, walk across it and down a
   wall to the floor.
4. **Boot Hop** — boots on, jump, jump beside a wall to land on it, walk up it.

Then the paint puzzles (with light coaching — they clear when every surface is
repaired):

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

## iOS (TestFlight)

A native iPhone/iPad build wraps the same Vite bundle in a Capacitor shell
(`ios/`, Swift Package Manager — no CocoaPods, so it's generated and synced from
Linux). Universal app: iPhone **and** iPad (`TARGETED_DEVICE_FAMILY = 1,2`).
Native extras: Taptic haptics on paint, landscape-only, fullscreen.

```bash
npm run build:ios                      # web build + cap sync ios
git tag ios-v0.1.0 && git push origin ios-v0.1.0   # CI builds + uploads to TestFlight
```

`.github/workflows/ios.yml` runs on a `macos-26` runner (no Mac needed): archive
with the team's persistent Distribution + Development identities (repo secrets),
export, upload. Build number = Unix epoch; marketing version = the tag. Bundle ID
`com.dnuke.frontierpainter`. App icon + launch screen come from
`npm run icons`.

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

# Phone playthrough (emulated iPhone, real touch input; solves room 1 and
# goes through the exit door into room 2) -> demos/mobile/
npm run playthrough:mobile

# Same touch flow on an iPad mini-sized screen -> demos/ipad/
npm run playthrough:ipad

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
