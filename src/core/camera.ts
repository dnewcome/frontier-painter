// src/core/camera.ts
// The camera rig with 'demo' (ArcRotate framing the room interior + action) and
// 'fp' (Universal, follows the player) modes. The rig knows nothing about
// gameplay; it is fed the player pose each rendered frame via update().
//
// The rig performs NO time integration: every frame it is handed pose values
// that are pure functions of the deterministic fixed-step sim (player position,
// look direction, surface-relative up), so a screenshot at a given cumulative
// step count is reproducible. See docs/slice-magboots-design.md §2 and §6.
import type { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { CameraMode, Vec3 } from "../types";

export interface CameraRig {
  setMode(mode: CameraMode): void;
  getMode(): CameraMode;
  /**
   * Called each rendered frame to track the player.
   * @param playerUp Surface-relative camera up (qRender·(0,1,0) while booted,
   *   [0,1,0] while floating). Optional and defaults to world up so existing
   *   callers stay backward compatible.
   */
  update(playerPos: Vec3, playerForward: Vec3, playerUp?: Vec3): void;
}

// The room is a sealed box, 16 (X) x 6 (Y) x 20 (Z), so its interior spans
// x in [-8, 8], y in [0, 6], z in [-10, 10]. The walls render double-sided, so a
// legible "demo" framing has to sit INSIDE the box: an exterior camera would only
// see the outside of the near wall and occlude everything. The slice-1 action
// runs along the +Z axis from the player spawn (~z = -8) to the glowing goal
// (~z = 8); with magnetic boots the player also climbs the walls (x -> ±8) and
// the ceiling (y -> 6), so the demo camera tracks the player instead of holding a
// single whole-room vantage.
const ACTION_TARGET = new Vector3(0, 1, 1);
// Initial demo eye (first rendered frame, before any update() retargets to the
// player). An oblique corner vantage tucked just inside the back/-X corner of
// the sealed box and lifted above the action line.
const DEMO_EYE = new Vector3(-7, 4.4, -9.3);
// Wide field of view so the full run between spawn and goal stays framed, and
// the player stays in frame as they climb a wall / cross onto the ceiling.
const DEMO_FOV = 1.5;

// Constant oblique world-space offset from the player to the demo eye: above
// (+Y), to the -X side, and behind the typical +Z travel direction so the goal
// ahead stays visible. Held constant (not facing-relative) so the framing is a
// pure deterministic function of the player position.
const DEMO_EYE_OFFSET = new Vector3(-5, 3.5, -5);

// The tracked demo eye is clamped to the box interior (with a small margin so it
// never sits in a wall) to mitigate the §9 "tracking pulls the camera near/through
// a wall and clips context" risk: an eye outside the sealed box would see only the
// outsides of the double-sided walls.
const EYE_MARGIN = 0.3;
const EYE_MIN_X = -8 + EYE_MARGIN;
const EYE_MAX_X = 8 - EYE_MARGIN;
const EYE_MIN_Y = 0 + EYE_MARGIN;
const EYE_MAX_Y = 6 - EYE_MARGIN;
const EYE_MIN_Z = -10 + EYE_MARGIN;
const EYE_MAX_Z = 10 - EYE_MARGIN;

// Fallbacks for degenerate (zero/non-finite) pose inputs.
const FALLBACK_FORWARD: Vec3 = [0, 0, 1]; // face +Z (toward the goal).
const FALLBACK_UP: Vec3 = [0, 1, 0]; // world up.
const DEFAULT_UP: Vec3 = [0, 1, 0];

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

class CameraRigImpl implements CameraRig {
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly demoCam: ArcRotateCamera;
  private readonly fpCam: UniversalCamera;
  // Reusable scratch vectors so the per-frame update() allocates nothing.
  private readonly fpForward = new Vector3(0, 0, 1);
  private readonly fpUp = new Vector3(0, 1, 0);
  private readonly fpRight = new Vector3(1, 0, 0);
  private readonly demoTarget = new Vector3();
  private readonly demoEye = new Vector3();
  private mode: CameraMode = "demo";

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.canvas = canvas;

    // 'demo' framing: an ArcRotate that orbits the action centre from inside the
    // room. Constructed with the action target, then placed at the chosen eye
    // (setPosition derives alpha/beta/radius from eye->target so the look is
    // exact regardless of the seed angles).
    this.demoCam = new ArcRotateCamera(
      "demoCam",
      -Math.PI / 2,
      Math.PI / 2.2,
      ACTION_TARGET.subtract(DEMO_EYE).length(),
      ACTION_TARGET.clone(),
      scene,
    );
    this.demoCam.setPosition(DEMO_EYE.clone());
    this.demoCam.fov = DEMO_FOV;
    // Tight near/far: the sealed room spans ~26 m, so a small far plane gives
    // good depth-buffer precision and kills z-fighting flicker on the dressing.
    this.demoCam.minZ = 0.1;
    this.demoCam.maxZ = 60;
    // Keep manual orbiting (headed mode only) from leaving the sealed room.
    this.demoCam.lowerRadiusLimit = 2;
    this.demoCam.upperRadiusLimit = 16;
    this.demoCam.lowerBetaLimit = 0.2;
    this.demoCam.upperBetaLimit = Math.PI / 2 + 0.25;
    this.demoCam.wheelDeltaPercentage = 0.01;

    // 'fp' first-person: a Universal camera driven entirely by update(). Seeded
    // at the spawn pose so the very first frame is sane before any update tick.
    this.fpCam = new UniversalCamera("fpCam", new Vector3(0, 1, -8), scene);
    this.fpCam.minZ = 0.1;
    this.fpCam.maxZ = 60;
    // Orient via rotationQuaternion (see updateFp) rather than Euler/setTarget so
    // wall/ceiling up vectors are honored without gimbal pop.
    this.fpCam.rotationQuaternion = new Quaternion();

    this.setMode("demo");
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    const cam = mode === "demo" ? this.demoCam : this.fpCam;
    this.scene.activeCamera = cam;
    // Detach both, attach only the active one (input only matters in headed).
    this.demoCam.detachControl();
    this.fpCam.detachControl();
    cam.attachControl(this.canvas, true);
  }

  getMode(): CameraMode {
    return this.mode;
  }

  update(
    playerPos: Vec3,
    playerForward: Vec3,
    playerUp: Vec3 = DEFAULT_UP,
  ): void {
    if (this.mode === "fp") {
      this.updateFp(playerPos, playerForward, playerUp);
    } else {
      this.updateDemo(playerPos);
    }
  }

  // First-person: ride the player and orient from the player's basis. We build
  // the quaternion with RotationQuaternionFromAxisToRef(right, up, forward) — the
  // SAME construction the controller uses for getForward()/getUp() — rather than
  // FromLookDirectionLH, which is flipped 180° about up in this Babylon build and
  // made the camera face opposite the player's true forward (so W walked you
  // "backward"). We feed the surface-relative up so the view re-rights onto walls
  // and the ceiling (setTarget would force world-Y up and fight that up vector).
  private updateFp(pos: Vec3, forward: Vec3, up: Vec3): void {
    this.fpCam.position.set(pos[0], pos[1], pos[2]);

    toSafeUnit(forward, FALLBACK_FORWARD, this.fpForward);
    toSafeUnit(up, FALLBACK_UP, this.fpUp);
    // Make up strictly orthogonal to forward. If the controller ever hands us an
    // up parallel to the look direction (e.g. pitch driven to vertical),
    // cross(up, forward) would be zero and the basis would degenerate to NaN;
    // re-deriving a perpendicular up keeps the orientation finite and pop-free.
    orthonormalizeUp(this.fpForward, this.fpUp);

    // right = up × forward (left-handed: local +X). With (right, up, forward) as
    // the new x/y/z axes, the camera's local +Z maps exactly to `forward`.
    Vector3.CrossToRef(this.fpUp, this.fpForward, this.fpRight);
    this.fpRight.normalize();

    const q = this.fpCam.rotationQuaternion ?? new Quaternion();
    this.fpCam.rotationQuaternion = q;
    Quaternion.RotationQuaternionFromAxisToRef(
      this.fpRight,
      this.fpUp,
      this.fpForward,
      q,
    );
    q.normalize();
  }

  // Demo: track the player so traversal across surfaces stays legible. Look at
  // the player and sit at a constant oblique world offset (clamped inside the
  // sealed box). setTarget MUST precede setPosition so the ArcRotate derives
  // alpha/beta/radius relative to the up-to-date target. Pure function of the
  // fixed-step player position -> deterministic.
  private updateDemo(pos: Vec3): void {
    this.demoTarget.set(pos[0], pos[1], pos[2]);
    this.demoEye.set(
      clamp(pos[0] + DEMO_EYE_OFFSET.x, EYE_MIN_X, EYE_MAX_X),
      clamp(pos[1] + DEMO_EYE_OFFSET.y, EYE_MIN_Y, EYE_MAX_Y),
      clamp(pos[2] + DEMO_EYE_OFFSET.z, EYE_MIN_Z, EYE_MAX_Z),
    );
    this.demoCam.setTarget(this.demoTarget);
    this.demoCam.setPosition(this.demoEye);
  }
}

// Normalize `src` into `out`; if `src` is zero/non-finite, write `fallback`.
function toSafeUnit(src: Vec3, fallback: Vec3, out: Vector3): void {
  const len = Math.hypot(src[0], src[1], src[2]);
  if (len > 1e-6) {
    out.set(src[0] / len, src[1] / len, src[2] / len);
  } else {
    out.set(fallback[0], fallback[1], fallback[2]);
  }
}

// Project `u` onto the plane perpendicular to unit `f`, then normalize, so the
// pair (f, u) is a valid look/up basis. If `u` is parallel to `f` the projection
// collapses, so re-seed `u` from a world axis that is not parallel to `f`.
function orthonormalizeUp(f: Vector3, u: Vector3): void {
  let d = u.x * f.x + u.y * f.y + u.z * f.z;
  u.set(u.x - d * f.x, u.y - d * f.y, u.z - d * f.z);
  if (u.lengthSquared() < 1e-8) {
    // u was (near) parallel to f. Pick a reference axis off the look direction:
    // world +Y unless f is itself near-vertical, in which case world +X.
    const rx = Math.abs(f.y) > 0.9 ? 1 : 0;
    const ry = rx === 1 ? 0 : 1;
    d = rx * f.x + ry * f.y; // rz = 0
    u.set(rx - d * f.x, ry - d * f.y, -d * f.z);
  }
  u.normalize();
}

export function createCameraRig(
  scene: Scene,
  canvas: HTMLCanvasElement,
): CameraRig {
  return new CameraRigImpl(scene, canvas);
}
