# Slice design — Magnetic boots: walk in zero-g

Status: design (architect). Target: add a **magnetic-boots locomotion state** on top of the
existing kinematic zero-g player. The player can **plant** on any of the 6 interior surfaces and
**walk** the tangent plane (WASD + mouse-look), **transition** across 90° edges/corners onto the
adjacent surface (floor → wall → ceiling), and **detach** to **float** — handing velocity back to
the existing free-float integrator so the existing draw → grab → pull → goal → win loop still
works mid-air.

All HARD INVARIANTS are preserved:
1. `window.game` + `GameState` are **extended, never broken** (every new field/method is additive).
2. **Determinism**: every bit of boots state — plant/detach, surface selection, yaw/pitch, walk
   integration, edge transitions, and the camera reorientation tween — advances **only** inside
   `fixedUpdate(dt)` via the engine fixed-step pump and `window.game.step(dt,steps)`. No
   `Math.random` / `Date.now` / `performance.now` anywhere in sim/render. `reset()` restores an
   identical state (boots OFF, up = `[0,1,0]`, facing +Z, spawn pose).
3. **No physics engine** — kinematic plant + Babylon built-in collisions only.
4. The existing draw→freeze→grab→pull→goal→win loop keeps working (boots default **OFF**, so the
   current capture beats B1..B9 are untouched).
5. Gameplay actor colors unchanged (blue player, amber handhold, green/gold goal).

---

## 1. Room geometry & the 6 surface frames

Interior is a clean axis-aligned box (`src/world/room.ts`): X∈[-8,8], Y∈[0,6], Z∈[-10,10]
(`ROOM_X=16, ROOM_Y=6, ROOM_Z=20`). The 6 walls are the only colliders. Each interior surface has
an **inward normal** = the player "up" when planted on it:

| surface    | plane (axis=value) | inward normal (up) | tangent axes (rect bounds)        |
|------------|--------------------|--------------------|-----------------------------------|
| floor      | Y = 0              | `[ 0, 1, 0]`       | X∈[-8,8], Z∈[-10,10]              |
| ceiling    | Y = 6              | `[ 0,-1, 0]`       | X∈[-8,8], Z∈[-10,10]              |
| wallNegX   | X = -8             | `[ 1, 0, 0]`       | Y∈[0,6],  Z∈[-10,10]             |
| wallPosX   | X = 8              | `[-1, 0, 0]`       | Y∈[0,6],  Z∈[-10,10]             |
| wallNegZ   | Z = -10            | `[ 0, 0, 1]`       | X∈[-8,8], Y∈[0,6]                |
| wallPosZ   | Z = 10             | `[ 0, 0,-1]`       | X∈[-8,8], Y∈[0,6]                |

`standHeight` (config, default **1.0** — matches the existing spawn `[0,1,-8]` sitting 1 m above
the floor) is the player-center offset along the inward normal. The spawn therefore reads as
"standing on the floor" with no change to existing numbers.

### Surface-frame math

Given up `n` (inward normal) and a unit facing `f` in the tangent plane (`f·n ≈ 0`):

- **right** `r = normalize(cross(n, f))` — left-handed Babylon convention chosen so that on the
  floor (`n=[0,1,0]`, `f=[0,0,1]` toward the goal) `r = [1,0,0]` (+X), i.e. `D` strafes +X.
- **planted center** `C = contact + n * standHeight`, where `contact` is the projection of the
  center onto the surface plane.
- **walk** maps WASD to tangent displacement: `ΔC = (f * moveF + r * moveS) * walkSpeed * dt`,
  applied in the tangent plane (the normal coordinate of `C` is unchanged by a tangential move and
  is re-pinned to `standHeight` each step).
- **yaw** rotates facing about the up axis: `f' = rotate(f, n, dYaw)` (stays in the tangent plane).
- **pitch** is a *camera-only* tilt about `r`, clamped to `±pitchClamp` (default ~85°); it never
  affects walking. The look direction handed to the camera is `look = rotate(f, r, pitch)`.

### Edge / corner transitions (box unfolding)

The box is 90°, so transitions are analytic — no raycasts. Each fixed step, after the tangential
move, the contact point is tested against the current surface's tangent-rect bounds. If a tangent
coordinate `c_a` on axis `a` exceeds its bound `B` by `d = |c_a - B| > 0`, the player has walked
over the edge shared with the wall at `a = B`:

1. **new surface** `s'` = the surface whose plane is at `a=B`, inward normal `n'` pointing back into
   the room (`n'_a = -sign(c_a - B)` along `a`).
2. **unfold the overshoot**: the coordinate along the *old* surface's normal axis `m` becomes
   `contact'_m = s.planeValue + s.inwardSign * d` (you climb `d` up the new face). The coordinate
   on `a` pins to `B`; the third (shared-edge) axis is unchanged. New center:
   `C'_a = B + n'_a * standHeight`, `C'_m = contact'_m`, third axis unchanged.
   *Example floor → wallPosX:* walk +X past `x=8` by `d` ⇒ new up `[-1,0,0]`, new `y = d` (climb the
   wall), `x = 8 - standHeight`, `z` unchanged.
3. **reorient**: `R = shortestArc(n → n')` (always a 90° rotation about the shared-edge axis, so it
   is well-defined and never antipodal/NaN). Facing rotates with the surface: `f' = R · f`. Up
   **snaps** logically to `n'` for movement; the *rendered* orientation slerps `R` over
   `surfaceTweenSteps` fixed steps so the camera re-rights smoothly.

At most one edge is processed per step (per-step walk distance `≤ walkSpeed*dt ≈ 0.05 m ≪` face
size), so a corner (two axes out at once) simply resolves over two consecutive steps. The loop runs
until the contact is in-bounds, guaranteeing the player is always planted on exactly one surface.

---

## 2. Shared contract: controller ↔ camera (parallel-implementable)

The camera reads the player **only** through these getters; the controller and camera modules can be
built independently against this contract.

```ts
// Player getters (src/player/player.ts) — read by camera (per rendered frame) and automation.
getPosition(): Vec3;   // eye/center position (UNCHANGED).
getForward(): Vec3;    // unit camera LOOK direction in world space.
                       //   booted : qRender · (0,0,1)  (facing+pitch, tweened across transitions)
                       //   float  : velocity heading    (EXISTING behavior, unchanged)
getUp(): Vec3;         // unit camera up.
                       //   booted : qRender · (0,1,0)  (smoothed surface normal during tween)
                       //   float  : [0,1,0]            (world up — preserves current fp framing)
```

`qRender` is a `Quaternion` held by the controller and advanced ONLY in `fixedUpdate` (see §5), so
`getForward`/`getUp` are pure reads — the camera performs no time integration and stays deterministic.

```ts
// Camera (src/core/camera.ts) — signature EXTENDED, third arg optional ⇒ backward compatible.
update(playerPos: Vec3, playerForward: Vec3, playerUp?: Vec3): void;
```

When `playerUp` is omitted it defaults to `[0,1,0]` (existing callers unaffected). The fp camera
orients with a single gimbal-safe call:

```ts
this.fpCam.position.set(pos[0], pos[1], pos[2]);
const f = safeUnit(forward, [0, 0, 1]);   // guard against zero/NaN
const u = safeUnit(up,      [0, 1, 0]);
this.fpCam.rotationQuaternion ??= new Quaternion();
// FromLookDirectionLH builds an orthonormal basis from (forward, up): no gimbal pop, no NaN.
Quaternion.FromLookDirectionLH(
  new Vector3(f[0], f[1], f[2]),
  new Vector3(u[0], u[1], u[2]),
).normalize().clone(/* into */ this.fpCam.rotationQuaternion);
```

(`setTarget` is replaced by `rotationQuaternion` because `setTarget` forces world-Y up and would
fight a wall/ceiling up vector.)

---

## 3. Controller / player — new & changed exported signatures

```ts
// src/player/surfaceFrame.ts  (NEW — pure box-surface math, owned by the controller module)
export type SurfaceId =
  | "floor" | "ceiling" | "wallNegX" | "wallPosX" | "wallNegZ" | "wallPosZ";

export interface Surface {
  id: SurfaceId;
  normal: Vec3;          // inward normal == player up
  axis: 0 | 1 | 2;       // normal axis index (X=0,Y=1,Z=2)
  planeValue: number;    // surface coordinate on `axis`
  inwardSign: 1 | -1;    // direction of `normal` along `axis`
  tA: 0 | 1 | 2;         // tangent axis A
  tB: 0 | 1 | 2;         // tangent axis B
  minA: number; maxA: number;  // rect bounds on tA
  minB: number; maxB: number;  // rect bounds on tB
}

export const SURFACES: readonly Surface[];                 // the 6 surfaces (constants below)
export function surfaceById(id: SurfaceId): Surface;
/** Nearest surface to a world point, by perpendicular distance to each surface plane. */
export function nearestSurface(center: Vec3): { surface: Surface; dist: number };
/** right = normalize(cross(up, forward)); falls back to a stable basis if forward∥up. */
export function tangentRight(up: Vec3, forward: Vec3): Vec3;
/** Rotate v about unit axis by angle (radians). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3;
/** Shortest-arc 90° quaternion mapping nFrom → nTo (orthogonal unit normals). */
export function reorientQuat(nFrom: Vec3, nTo: Vec3): Quaternion;

/** Re-plant after a tangential move: pin to standHeight, unfold across any edge crossings.
 *  Pure: returns the resulting plant. Iterates until contact is in-bounds (≤2 iters in practice). */
export function replant(
  center: Vec3, surface: Surface, facing: Vec3, standHeight: number,
): {
  center: Vec3;        // re-pinned (and unfolded) center
  surface: Surface;    // possibly the adjacent surface
  facing: Vec3;        // rotated by R on each crossing
  reorient: Quaternion | null; // accumulated R if a transition happened, else null
};
```

`SURFACES` constants (interior bounds baked from room.ts; if room dims ever change they are derived
from the same numbers):

```ts
export const SURFACES: readonly Surface[] = [
  { id:"floor",   normal:[0,1,0],  axis:1, planeValue:0,   inwardSign:1,
    tA:0, tB:2, minA:-8, maxA:8, minB:-10, maxB:10 },
  { id:"ceiling", normal:[0,-1,0], axis:1, planeValue:6,   inwardSign:-1,
    tA:0, tB:2, minA:-8, maxA:8, minB:-10, maxB:10 },
  { id:"wallNegX",normal:[1,0,0],  axis:0, planeValue:-8,  inwardSign:1,
    tA:1, tB:2, minA:0,  maxA:6, minB:-10, maxB:10 },
  { id:"wallPosX",normal:[-1,0,0], axis:0, planeValue:8,   inwardSign:-1,
    tA:1, tB:2, minA:0,  maxA:6, minB:-10, maxB:10 },
  { id:"wallNegZ",normal:[0,0,1],  axis:2, planeValue:-10, inwardSign:1,
    tA:0, tB:1, minA:-8, maxA:8, minB:0,   maxB:6 },
  { id:"wallPosZ",normal:[0,0,-1], axis:2, planeValue:10,  inwardSign:-1,
    tA:0, tB:1, minA:-8, maxA:8, minB:0,   maxB:6 },
];
```

```ts
// src/player/controller.ts  (EXTENDED — add a walk integrator beside the existing float one)
export interface KinematicController {
  integrate(mesh: Mesh, velocity: Vec3, dt: number): void;   // EXISTING float integrator (unchanged)
  /** Booted: apply tangential walk + re-plant; returns the new plant + tween rotation.
   *  Sets mesh.position directly (kinematic). Does NOT use moveWithCollisions — the box is
   *  unfolded analytically, so colliders never fight the plant. */
  walkStep(
    mesh: Mesh, plant: PlantState, moveF: number, moveS: number, dt: number,
  ): { plant: PlantState; reorient: Quaternion | null };
}

export interface PlantState {
  surface: Surface;   // current surface (logical up = surface.normal)
  facing: Vec3;       // unit tangent facing
  pitch: number;      // camera pitch (rad), clamped ±pitchClamp
}
```

```ts
// src/player/player.ts  (EXTENDED — boots state machine + new verbs; existing API unchanged)
export interface Player {
  // ---- existing (unchanged) ----
  fixedUpdate(dt: number): void;
  applyImpulse(v: Vec3): void;
  grab(): HandholdId | null;
  release(): void;
  pullAlong(speed: number, dt: number): void;
  moveTo(target: Vec3): void;
  getPosition(): Vec3;
  getVelocity(): Vec3;
  getForward(): Vec3;
  isGrabbing(): boolean;
  getGrabbedId(): HandholdId | null;
  getGrabT(): number | null;
  reset(): void;

  // ---- NEW: magnetic boots ----
  /** Plant on / detach from a surface. Plant snaps to the nearest surface (up = its normal),
   *  zeroing the normal velocity component. Detach hands the current (tangential) walk velocity
   *  to the float integrator. No wall-clock reads. */
  setBooted(on: boolean): void;
  isBooted(): boolean;
  /** Persistent walk intent in [-1,1] (like held keys); consumed each fixedUpdate while booted. */
  walkInput(forward: number, strafe: number): void;
  /** Best-effort auto-walk toward a world target (steers facing in the tangent plane, walks
   *  forward; transitions surfaces en route). Reproducible primitive remains walkInput+turn+step. */
  walkTo(target: Vec3): void;
  /** Yaw by `dYaw` rad about the surface normal (booted only). */
  turn(dYaw: number): void;
  /** Absolute look: yaw about normal, optional clamped pitch (booted only). */
  setFacing(yaw: number, pitch?: number): void;
  /** Detach + impulse `speed` along the current surface normal (jump off). */
  pushOff(speed: number): void;
  /** Camera up: qRender·(0,1,0) booted (tweened), else [0,1,0]. */
  getUp(): Vec3;
  /** Logical current surface inward normal when booted, else [0,1,0]. */
  getSurfaceNormal(): Vec3;
  /** Unit tangent facing when booted, else current forward heading. */
  getFacing(): Vec3;
}
```

`fixedUpdate` branches on boots:

```ts
fixedUpdate(dt: number): void {
  if (this.booted) {
    const { plant, reorient } = this.controller.walkStep(
      this.mesh, this.plant, this.moveF, this.moveS, dt);
    this.plant = plant;
    if (reorient) this.beginTween(reorient);   // qFrom=qRender, tweenRemaining=surfaceTweenSteps
    this.advanceTween(dt);                      // slerp qRender→qTarget over fixed steps
    this.trackWalkVelocity(dt);                 // for velocity handoff on detach
    return;                                     // grab/float integration suspended while booted
  }
  // ---- existing float path (unchanged) ----
  if (this.grabbing) return;
  this.controller.integrate(this.mesh, this.velocity, dt);
  /* ...existing forward-from-velocity update... */
}
```

`qTarget = Quaternion.FromLookDirectionLH(look, normal)` is recomputed each booted step from
`plant.facing`, `plant.pitch`, and `plant.surface.normal`; `qRender` equals `qTarget` except during
a transition tween.

---

## 4. Automation API & GameState additions (additive / backward compatible)

```ts
// src/gameApi.ts — append to GameApi (existing methods unchanged)
export interface GameApi {
  /* ...existing... */
  /** Plant on the nearest surface (on) or detach into free-float (off). */
  setBoots(on: boolean): void;
  /** Set persistent walk intent in [-1,1]; consumed each step() while booted. walk(0,0) stops. */
  walk(forward: number, strafe: number): void;
  /** Best-effort auto-walk toward a world point along surfaces. */
  walkTo(target: Vec3): void;
  /** Yaw by `dYaw` radians about the surface normal. */
  turn(dYaw: number): void;
  /** Absolute facing: yaw about normal, optional clamped pitch (radians). */
  setFacing(yaw: number, pitch?: number): void;
  /** Detach + impulse `speed` (m/s) along the current surface normal. */
  pushOff(speed: number): void;
}
```

```ts
// src/types.ts — append to GameState (existing fields unchanged ⇒ no consumer breaks)
export interface GameState {
  /* ...existing... */
  booted: boolean;        // true while planted on a surface
  surfaceNormal: Vec3;    // logical up == current surface inward normal ([0,1,0] when floating)
  up: Vec3;               // rendered/smoothed camera up (tweened across transitions)
  facing: Vec3;           // unit tangent facing (booted) or forward heading (floating)
}
```

```ts
// src/types.ts — append to SimConfig + DEFAULT_CONFIG (additive: existing callers compile)
export interface SimConfig {
  /* ...existing... */
  walkSpeed: number;          // tangential walk speed (m/s)
  standHeight: number;        // player-center offset along surface normal (m)
  turnRate: number;           // yaw rate for walkTo / key turn (rad/s)
  pitchClamp: number;         // max |pitch| (rad)
  surfaceTweenSteps: number;  // fixed steps to slerp the up reorientation on a transition
  reEngageDistance: number;   // max plane distance (m) at which setBoots(true) will plant
  pushOffSpeed: number;       // default push-off impulse (m/s)
}
export const DEFAULT_CONFIG: SimConfig = {
  /* ...existing... */
  walkSpeed: 3.0,
  standHeight: 1.0,           // keeps spawn [0,1,-8] reading as "on the floor"
  turnRate: 2.5,
  pitchClamp: 1.483,          // ~85°
  surfaceTweenSteps: 18,      // ~0.3 s at 1/60
  reEngageDistance: 1.5,
  pushOffSpeed: 3.0,
};
```

`automation.ts` wiring: `getState()` adds the 4 fields from `player.getUp/getSurfaceNormal/
getFacing/isBooted`; the per-frame observer passes the up vector:
`camera.update(player.getPosition(), player.getForward(), player.getUp())`. New verbs forward 1:1 to
the player (`walk→walkInput`, `pushOff→player.pushOff`, etc.). `reset()` already routes through
`player.reset()`, which now also clears boots → `booted=false, up=[0,1,0], facing=[0,0,1]`.

---

## 5. Determinism plan

- All boots mutation happens in `player.fixedUpdate(dt)` (walk integration, re-plant, tween) or in
  intent setters (`walk/walkInput`, `turn`, `setFacing`, `setBoots`, `pushOff`, `walkTo`) that only
  store values / snap state — none read wall-clock or RNG.
- The reorientation tween is an **integer step countdown** (`surfaceTweenSteps`), decremented once
  per fixed step; `t = (surfaceTweenSteps - tweenRemaining) / surfaceTweenSteps`,
  `qRender = Quaternion.Slerp(qFrom, qTarget, t)`. Identical step counts ⇒ identical `qRender`.
- `walkStep` sets `mesh.position` directly (no `moveWithCollisions`), so collider resolution order
  can't introduce nondeterminism; the analytic unfold guarantees the player stays inside the box.
- The camera does **no** time integration: fp orientation is `FromLookDirectionLH(getForward, getUp)`
  and the demo target is `getPosition()` directly (pure functions of fixed-step state), so a
  screenshot at a given cumulative step count is reproducible.
- `reset()` restores boots OFF + default frame; combined with the existing reset of registry/world,
  a replay (capture B9 / new M-replay beat) reproduces position and the full surfaceNormal sequence.

---

## 6. Camera changes (`src/core/camera.ts`)

- **fp**: switch from `setTarget` to `rotationQuaternion = FromLookDirectionLH(forward, up)` (see §2)
  so wall/ceiling up vectors are respected with no gimbal pop. `minZ` stays small. Guard degenerate
  forward/up.
- **demo**: track the player so traversal stays legible. The ArcRotate `setTarget(playerPos)` each
  frame (a pure function of fixed-step state), with a constant eye offset and a slightly widened FOV
  / radius so the player remains framed as they climb a wall. Existing capture beats keep the player
  centered (no pixel assertions exist, so this is non-breaking). When floating, demo behaves as a
  legible chase/overview of the action; when booted it pans to keep the climbing player in frame.

---

## 7. Human input mapping (`src/input/humanInput.ts`, headed only)

Determinism is preserved — this module perturbs the sim ONLY through per-fixed-step intent
(`walkInput`/`applyImpulse`) and one-shot verbs; the scripted `window.game.step()` path never fires
DOM events.

- **B**: toggle boots (`player.setBooted(!isBooted())`); also `camera.setMode("fp")` on plant for
  the intended first-person experience.
- **Booted**:
  - **WASD** → tracked in the `pressed` set; each fixed step set `walkInput(fwd, strafe)`
    (`W`+1/`S`-1 forward, `D`+1/`A`-1 strafe), `walkInput(0,0)` when none held.
  - **Mouse move** (fp + pointer-lock) → `turn(dx * lookSensitivity)` and pitch via
    `setFacing(currentYaw, currentPitch - dy * lookSensitivity)`.
  - **Space** → `pushOff(config.pushOffSpeed)` (jump off the surface).
- **Floating** (existing behavior retained): WASD = camera-plane thrust, E/Q = up/down, **G**/**Space**
  = grab toggle. (Space is push-off only while booted; grab toggle while floating — documented.)
- **C** toggle camera, **R** reset — unchanged.

---

## 8. Demo beats (append after existing B1..B9 in `playthrough/capture.mjs`)

Each beat drives only `window.game` + `step()` (no synthetic input) and screenshots one frame.

- **M1 — plant**: `reset(); setCameraMode("fp"); setBoots(true); step(1/60,2)`. Assert
  `booted===true`, `surfaceNormal≈[0,1,0]`, `up≈[0,1,0]`.
- **M2 — walk to wall**: `setFacing(0)` (face +X), `walk(1,0)`; `step(1/60,1)` in a loop until
  `surfaceNormal` flips to `[-1,0,0]`. Assert transition occurred and player `y` increased (climbed).
- **M3 — wall to ceiling**: keep walking; loop `step` until `surfaceNormal≈[0,-1,0]`. Assert the
  player is now on the ceiling (`y≈6-standHeight`), confirming floor→wall→ceiling traversal.
- **M4 — push off & draw**: `pushOff(3)`; assert `booted===false` and velocity along the old normal;
  then `drawStroke([...])` mid-air; assert `handholds.length` increased (zero-g drawing preserved).
- **M5 — re-engage**: drift/`moveTo` near a surface, `setBoots(true)`; assert re-planted
  (`booted===true`, `surfaceNormal` = that surface's normal, height snapped to standHeight).
- **M6 — legacy loop intact**: run grab→pullAlong→goal exactly as B5..B8 from the float state to
  prove the existing win loop still works after the boots additions.
- **M7 — determinism replay**: re-run M1..M3 inside one `evaluate`; assert the surfaceNormal
  sequence and final position reproduce within tolerance.

---

## 9. Risks

- **Demo retarget framing**: tracking the player may pull the camera near a wall and clip context;
  mitigate with a constant oblique eye offset + widened FOV; tune during implementation.
- **Corner double-transition**: handled by iterating `replant` until in-bounds (≤2 iters at walk
  speed); verify with a beat that walks diagonally into a corner.
- **standHeight vs ellipsoid**: walking sets position directly; ensure `standHeight ≥ ellipsoid` so
  the planted center never tunnels a wall. Default 1.0 ≫ 0.4 — safe.
- **Velocity handoff direction**: `trackWalkVelocity` must capture the last tangential displacement
  (not include the re-pin), or detach speed will be wrong at an edge.
- **fp upVector**: must set `rotationQuaternion` (not `setTarget`) or the camera snaps to world-Y up
  on walls/ceiling.
- **Backward compat**: boots default OFF is load-bearing for B1..B9; a future change defaulting boots
  ON would break the existing approach beats (`moveTo`/`applyImpulse` are no-ops while booted).
