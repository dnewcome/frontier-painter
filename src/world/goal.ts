// src/world/goal.ts
// The goal marker: a glowing emissive sphere plus the win-test (distance from
// the player center to the goal center < goalRadius). Purely procedural; no
// external assets, no time/RNG reads (the win latch is driven by the fixed-step
// pump in automation, so reset() restores a byte-identical state).
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vec3 } from "../types";

export interface Goal {
  readonly position: Vec3;
  /** True when `pos` is within config.goalRadius of the goal center. */
  isReached(pos: Vec3): boolean;
  reached(): boolean;
  setReached(v: boolean): void;
  reset(): void;
}

// Emissive tints: idle (inviting green) and won (bright gold).
const IDLE_EMISSIVE = new Color3(0.1, 0.9, 0.4);
const WON_EMISSIVE = new Color3(1.0, 0.85, 0.2);

class GoalImpl implements Goal {
  readonly position: Vec3;
  private readonly radius: number;
  private readonly mesh: Mesh;
  private readonly mat: StandardMaterial;
  private latched = false;

  constructor(scene: Scene, position: Vec3, radius: number) {
    // Store a private copy so callers can't mutate our center out from under us.
    this.position = [position[0], position[1], position[2]];
    this.radius = radius;

    // Visible marker. Kept a bit smaller than the (forgiving) win radius so the
    // sphere reads as a precise target rather than a fuzzy blob.
    this.mesh = MeshBuilder.CreateSphere(
      "goal",
      { diameter: radius * 1.2, segments: 24 },
      scene,
    );
    this.mesh.position.set(this.position[0], this.position[1], this.position[2]);
    // The marker is a pure visual: it must never block the player or intercept
    // fp-mode drawing raycasts.
    this.mesh.checkCollisions = false;
    this.mesh.isPickable = false;
    this.mesh.freezeWorldMatrix();

    this.mat = new StandardMaterial("goalMat", scene);
    this.mat.emissiveColor = IDLE_EMISSIVE.clone();
    this.mat.diffuseColor = new Color3(0.05, 0.3, 0.15);
    this.mat.specularColor = new Color3(0.2, 0.2, 0.2);
    this.mesh.material = this.mat;
  }

  isReached(pos: Vec3): boolean {
    const dx = pos[0] - this.position[0];
    const dy = pos[1] - this.position[1];
    const dz = pos[2] - this.position[2];
    return dx * dx + dy * dy + dz * dz < this.radius * this.radius;
  }

  reached(): boolean {
    return this.latched;
  }

  setReached(v: boolean): void {
    this.latched = v;
    // Brighten on win so a recorded playthrough is legible.
    this.mat.emissiveColor = (v ? WON_EMISSIVE : IDLE_EMISSIVE).clone();
  }

  reset(): void {
    this.setReached(false);
  }
}

/** Creates the emissive goal marker mesh and its win-test at `position`. */
export function createGoal(
  scene: Scene,
  position: Vec3,
  radius: number,
): Goal {
  return new GoalImpl(scene, position, radius);
}
