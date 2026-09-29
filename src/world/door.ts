// src/world/door.ts
// The room's EXIT: a sliding double door set into the far (+Z) wall, right
// behind the console. It stays sealed (red status light) until the console
// comes online, then its two panels retract into the jambs (green light),
// revealing a lit airlock. Moving into the doorway clears the room.
//
// Purely visual + a doorway volume test. The +Z wall's collision box is left
// intact: the doorway volume starts in front of the wall face (z > DOORWAY_Z),
// short of where the player's ellipsoid would touch it, so you trigger the exit
// before you could ever bump the wall behind the opening. The open animation
// advances in fixed steps (no clock reads), keeping reset() deterministic.
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vec3 } from "../types";
import { makeAirlockTexture } from "../dressing/textures";

export interface Door {
  /** Center of the doorway opening (for aiming / screen projection). */
  readonly anchor: Vec3;
  /** Command the door open or shut; the panels animate in fixedUpdate(). */
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /** 0 = sealed, 1 = fully retracted. */
  progress(): number;
  /** True when `pos` is inside the doorway volume. */
  inDoorway(pos: Vec3): boolean;
  fixedUpdate(dt: number): void;
  reset(): void;
}

export interface DoorOptions {
  /** z of the inner face of the wall the door is set into. */
  wallZ: number;
  /** y of the inner floor surface (the door sill). */
  floorY: number;
}

const WIDTH = 2.2;
const HEIGHT = 2.2;
/** Seconds for the panels to fully retract. */
const OPEN_SECONDS = 0.9;
/** How far in front of the wall face the doorway volume begins (m). Must be
 *  MORE than the player's ellipsoid radius (0.4) plus the boots' walkable-rect
 *  margin, or the wall would stop the player before they reach the volume. */
const DOORWAY_DEPTH = 0.75;

const LIGHT_SEALED = new Color3(1.0, 0.18, 0.12);
const LIGHT_OPEN = new Color3(0.3, 1.0, 0.55);

class DoorImpl implements Door {
  readonly anchor: Vec3;
  private readonly wallZ: number;
  private readonly sill: number;
  private readonly left: Mesh;
  private readonly right: Mesh;
  private readonly lightMat: StandardMaterial;
  private open = false;
  private p = 0;
  private shownP = -1;

  constructor(scene: Scene, o: DoorOptions) {
    this.wallZ = o.wallZ;
    this.sill = o.floorY;
    const cy = o.floorY + HEIGHT / 2;
    this.anchor = [0, cy, o.wallZ - 0.06];

    const visual = (m: Mesh): Mesh => {
      m.checkCollisions = false;
      m.isPickable = false;
      return m;
    };

    // The lit airlock behind the panels (in front of the wall skin at -0.02).
    const inner = visual(MeshBuilder.CreatePlane("door_airlock", { width: WIDTH, height: HEIGHT }, scene));
    const innerMat = new StandardMaterial("door_airlockMat", scene);
    innerMat.diffuseTexture = makeAirlockTexture(scene, "door_airlockTex");
    innerMat.emissiveColor = new Color3(0.35, 0.38, 0.42);
    innerMat.specularColor = new Color3(0, 0, 0);
    innerMat.backFaceCulling = false;
    inner.material = innerMat;
    inner.position.set(0, cy, o.wallZ - 0.06);
    // A Babylon plane's front face already points -Z, i.e. into the room.
    inner.freezeWorldMatrix();

    // Frame: two jambs + a header, proud of the wall.
    const frameMat = new StandardMaterial("door_frameMat", scene);
    frameMat.diffuseColor = new Color3(0.2, 0.22, 0.27);
    frameMat.specularColor = new Color3(0.15, 0.15, 0.17);
    const jamb = 0.26;
    const depth = 0.24;
    const fz = o.wallZ - depth / 2;
    for (const sx of [-1, 1]) {
      const j = visual(
        MeshBuilder.CreateBox(`door_jamb${sx}`, { width: jamb, height: HEIGHT + jamb, depth }, scene),
      );
      j.material = frameMat;
      j.position.set(sx * (WIDTH / 2 + jamb / 2), o.floorY + (HEIGHT + jamb) / 2, fz);
      j.freezeWorldMatrix();
    }
    const header = visual(
      MeshBuilder.CreateBox("door_header", { width: WIDTH + 2 * jamb, height: jamb, depth }, scene),
    );
    header.material = frameMat;
    header.position.set(0, o.floorY + HEIGHT + jamb / 2, fz);
    header.freezeWorldMatrix();

    // Status light strip across the header face.
    this.lightMat = new StandardMaterial("door_lightMat", scene);
    this.lightMat.diffuseColor = new Color3(0, 0, 0);
    this.lightMat.specularColor = new Color3(0, 0, 0);
    this.lightMat.emissiveColor = LIGHT_SEALED.clone();
    const light = visual(MeshBuilder.CreatePlane("door_light", { width: WIDTH * 0.8, height: 0.09 }, scene));
    light.material = this.lightMat;
    light.position.set(0, o.floorY + HEIGHT + jamb / 2, o.wallZ - depth - 0.005);
    light.freezeWorldMatrix();

    // Panels: each anchored at its jamb, compressing sideways as it retracts.
    const panelMat = new StandardMaterial("door_panelMat", scene);
    panelMat.diffuseColor = new Color3(0.56, 0.6, 0.66);
    panelMat.specularColor = new Color3(0.25, 0.26, 0.3);
    const mk = (name: string): Mesh => {
      const m = visual(MeshBuilder.CreateBox(name, { width: WIDTH / 2, height: HEIGHT, depth: 0.08 }, scene));
      m.material = panelMat;
      m.position.set(0, cy, o.wallZ - 0.13);
      return m;
    };
    this.left = mk("door_panelL");
    this.right = mk("door_panelR");
    this.render();
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.lightMat.emissiveColor = (open ? LIGHT_OPEN : LIGHT_SEALED).clone();
  }

  isOpen(): boolean {
    return this.open;
  }

  progress(): number {
    return this.p;
  }

  inDoorway(pos: Vec3): boolean {
    return (
      Math.abs(pos[0]) < WIDTH / 2 &&
      pos[1] > this.sill &&
      pos[1] < this.sill + HEIGHT &&
      pos[2] > this.wallZ - DOORWAY_DEPTH
    );
  }

  fixedUpdate(dt: number): void {
    const target = this.open ? 1 : 0;
    if (this.p === target) return;
    const step = dt / OPEN_SECONDS;
    this.p = target > this.p ? Math.min(1, this.p + step) : Math.max(0, this.p - step);
    this.render();
  }

  reset(): void {
    this.setOpen(false);
    this.p = 0;
    this.render();
  }

  private render(): void {
    if (this.p === this.shownP) return;
    this.shownP = this.p;
    // Ease-in-out so the panels crack, then glide.
    const e = this.p * this.p * (3 - 2 * this.p);
    const s = Math.max(0.03, 1 - e);
    const half = WIDTH / 2;
    this.left.scaling.x = s;
    this.right.scaling.x = s;
    this.left.position.x = -half + (half * s) / 2;
    this.right.position.x = half - (half * s) / 2;
  }
}

export function createDoor(scene: Scene, opts: DoorOptions): Door {
  return new DoorImpl(scene, opts);
}
