// src/player/avatar.ts
// The PLAYER AVATAR: a small, legible humanoid figure assembled from primitives
// that makes walking read in third-person. It is purely COSMETIC — every mesh
// has checkCollisions=false and isPickable=false; the actual physics body stays
// the invisible collision ellipsoid in player.ts. The avatar follows the
// deterministic player pose each rendered frame (no time / RNG), so screenshots
// at a given step count stay reproducible.
//
// Orientation is built from the SAME basis the fp camera uses
// (right = up x forward, then RotationQuaternionFromAxisToRef(right, up,
// forward)). The figure's local +Y is "up" (head up, boots down) and local +Z
// is "forward" (the visor faces forward), so feet plant toward the surface: it
// stands upright on the floor, sideways out of a wall, and head-down on the
// ceiling — the mag-boots fantasy, made visible.
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Vec3, CameraMode } from "../types";

export interface Avatar {
  /** Root transform node (positioned + oriented to the player pose). */
  readonly root: TransformNode;
  /**
   * Pose the avatar from the deterministic player basis and toggle visibility
   * by camera mode. Pure function of its inputs (no time / RNG).
   * @param pos     player center (world, m).
   * @param forward unit look/heading (player.getForward()).
   * @param up      surface-relative up (player.getUp()); feet point toward -up.
   * @param booted  whether boots are engaged (currently informational).
   * @param cameraMode hide in 'fp' (would fill the cockpit), show otherwise.
   */
  update(
    pos: Vec3,
    forward: Vec3,
    up: Vec3,
    booted: boolean,
    cameraMode: CameraMode,
  ): void;
  /** Force visibility independent of camera mode (e.g. for previews/tests). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

const FALLBACK_FORWARD: Vec3 = [0, 0, 1];
const FALLBACK_UP: Vec3 = [0, 1, 0];

function mat(scene: Scene, name: string, rgb: Vec3, glow: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(rgb[0], rgb[1], rgb[2]);
  m.emissiveColor = new Color3(rgb[0] * glow, rgb[1] * glow, rgb[2] * glow);
  m.specularColor = new Color3(0.1, 0.1, 0.12);
  return m;
}

class AvatarImpl implements Avatar {
  readonly root: TransformNode;
  private readonly parts: AbstractMesh[] = [];

  // Scratch vectors/quaternion so update() allocates nothing per frame.
  private readonly fwd = new Vector3(0, 0, 1);
  private readonly up = new Vector3(0, 1, 0);
  private readonly right = new Vector3(1, 0, 0);
  private readonly q = new Quaternion();

  constructor(scene: Scene) {
    this.root = new TransformNode("avatarRoot", scene);
    this.root.rotationQuaternion = new Quaternion();

    const blue: Vec3 = [0.25, 0.5, 0.95]; // body — it IS the player (BLUE)
    const lightBlue: Vec3 = [0.55, 0.75, 1.0]; // head
    const bootCol: Vec3 = [0.95, 0.55, 0.15]; // boots — distinct, warm
    const visorCol: Vec3 = [0.85, 0.95, 1.0]; // facing indicator (bright)

    const bodyMat = mat(scene, "avatarBody", blue, 0.18);
    const headMat = mat(scene, "avatarHead", lightBlue, 0.2);
    const bootMat = mat(scene, "avatarBoot", bootCol, 0.3);
    const visorMat = mat(scene, "avatarVisor", visorCol, 0.5);

    // BODY: a capsule along local +Y, center near the figure's middle.
    const body = MeshBuilder.CreateCapsule(
      "avatarBodyMesh",
      { height: 1.0, radius: 0.26, tessellation: 12, capSubdivisions: 4 },
      scene,
    );
    body.material = bodyMat;
    body.position.set(0, 0.0, 0);

    // HEAD: a small sphere above the body.
    const head = MeshBuilder.CreateSphere(
      "avatarHeadMesh",
      { diameter: 0.36, segments: 12 },
      scene,
    );
    head.material = headMat;
    head.position.set(0, 0.7, 0);

    // VISOR / NOSE: a small box on the FRONT (local +Z) of the head so the
    // figure's facing is unambiguous in third-person.
    const visor = MeshBuilder.CreateBox(
      "avatarVisorMesh",
      { width: 0.26, height: 0.1, depth: 0.14 },
      scene,
    );
    visor.material = visorMat;
    visor.position.set(0, 0.72, 0.2);

    // BOOTS: two distinct blocks at the feet (local -Y), extended along +Z so
    // they read as feet. They sit toward the planted surface.
    const bootL = MeshBuilder.CreateBox(
      "avatarBootL",
      { width: 0.2, height: 0.18, depth: 0.42 },
      scene,
    );
    bootL.material = bootMat;
    bootL.position.set(-0.15, -0.86, 0.06);

    const bootR = MeshBuilder.CreateBox(
      "avatarBootR",
      { width: 0.2, height: 0.18, depth: 0.42 },
      scene,
    );
    bootR.material = bootMat;
    bootR.position.set(0.15, -0.86, 0.06);

    this.parts.push(body, head, visor, bootL, bootR);
    for (const p of this.parts) {
      p.parent = this.root;
      p.checkCollisions = false;
      p.isPickable = false;
    }
  }

  update(
    pos: Vec3,
    forward: Vec3,
    up: Vec3,
    _booted: boolean,
    cameraMode: CameraMode,
  ): void {
    // Hide in first-person: the avatar would clip / fill the cockpit camera.
    const visible = cameraMode !== "fp";
    this.root.setEnabled(visible);
    if (!visible) return;

    this.root.position.set(pos[0], pos[1], pos[2]);

    toSafeUnit(forward, FALLBACK_FORWARD, this.fwd);
    toSafeUnit(up, FALLBACK_UP, this.up);
    // Make up strictly orthogonal to forward (guards a degenerate basis -> NaN).
    orthonormalizeUp(this.fwd, this.up);
    // right = up x forward (same construction the fp camera/controller use).
    Vector3.CrossToRef(this.up, this.fwd, this.right);
    this.right.normalize();

    Quaternion.RotationQuaternionFromAxisToRef(
      this.right,
      this.up,
      this.fwd,
      this.q,
    );
    this.q.normalize();
    (this.root.rotationQuaternion ?? (this.root.rotationQuaternion = new Quaternion())).copyFrom(
      this.q,
    );
  }

  setVisible(visible: boolean): void {
    this.root.setEnabled(visible);
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    this.root.dispose();
  }
}

function toSafeUnit(src: Vec3, fallback: Vec3, out: Vector3): void {
  const len = Math.hypot(src[0], src[1], src[2]);
  if (len > 1e-6) out.set(src[0] / len, src[1] / len, src[2] / len);
  else out.set(fallback[0], fallback[1], fallback[2]);
}

// Project `u` onto the plane perpendicular to unit `f` and normalize; reseed if
// `u` is (near) parallel to `f` so the (f, u) basis never degenerates.
function orthonormalizeUp(f: Vector3, u: Vector3): void {
  let d = u.x * f.x + u.y * f.y + u.z * f.z;
  u.set(u.x - d * f.x, u.y - d * f.y, u.z - d * f.z);
  if (u.lengthSquared() < 1e-8) {
    const rx = Math.abs(f.y) > 0.9 ? 1 : 0;
    const ry = rx === 1 ? 0 : 1;
    d = rx * f.x + ry * f.y;
    u.set(rx - d * f.x, ry - d * f.y, -d * f.z);
  }
  u.normalize();
}

export function createAvatar(scene: Scene): Avatar {
  return new AvatarImpl(scene);
}
