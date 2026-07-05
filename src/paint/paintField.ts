// src/paint/paintField.ts
// The property-paint verb made concrete: a set of "broken" (un-rendered)
// surfaces the painter repairs by applying the ONE correct physical property.
//
// Puzzle rule ("right property, right place"): each target has a single
// `required` property. Painting it with that property repairs it (runs its world
// effect + swaps to a "fixed" look); painting any other property is rejected and
// does nothing but flare the surface red. Paint is unlimited — the difficulty is
// deducing the right property, not spending a budget.
//
// Determinism: paint() is a pure state transition + mesh/material mutation and a
// deterministic registry.freeze() (no Math.random / Date.now / time reads), so it
// is safe to call from the scripted window.game path. Material tints are visual
// only (rendered, never part of the fixed-step simulation). The active scenario
// is toggled by setArmed(): while unarmed all target meshes are hidden and the
// field reports "complete", so the legacy magnetic-boots slice runs in the
// original empty room, untouched.
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vec3, PaintProperty, PaintSurfaceState } from "../types";
import type { HandholdRegistry } from "../drawing/drawing";

/** Named scenarios. "none" = empty room (legacy boots slice). */
export type ScenarioName = "none" | "frostgap";

/** Emissive tint per property, for the "fixed" look + HUD swatches. */
export const PROP_COLOR: Record<PaintProperty, Color3> = {
  cold: new Color3(0.55, 0.85, 1.0), // frost blue-white
  conductive: new Color3(1.0, 0.66, 0.16), // copper / amber
  magnetic: new Color3(0.72, 0.42, 1.0), // violet
};

const BROKEN_DIFFUSE = new Color3(0.16, 0.17, 0.2);
const BROKEN_EMISSIVE = new Color3(0.05, 0.06, 0.08);
const REJECT_EMISSIVE = new Color3(0.6, 0.06, 0.06);

export interface PaintField {
  /** Serializable state of every target in the armed scenario (else []). */
  states(): PaintSurfaceState[];
  /** Paint target `id` with `property`. True iff it repaired (correct) it. */
  paint(id: string, property: PaintProperty): boolean;
  /** True when every armed target is satisfied (vacuously true when unarmed). */
  complete(): boolean;
  /** Meshes a human aim-ray may target (empty when unarmed). */
  pickables(): Mesh[];
  /** Look up the target id owning a picked mesh, or null. */
  idForMesh(mesh: unknown): string | null;
  /** Load a scenario: show/hide its meshes and reset all targets to broken. */
  setScenario(name: ScenarioName): void;
  scenario(): ScenarioName;
  /** Reset all targets in the current scenario back to broken. */
  reset(): void;
}

interface Target {
  id: string;
  label: string;
  required: PaintProperty;
  painted: PaintProperty | null;
  /** The pickable placeholder mesh (the visible "broken surface"). */
  mesh: Mesh;
  mat: StandardMaterial;
  /** Extra effect meshes to enable/disable with the scenario. */
  extras: Mesh[];
  /** Repair effect (register a handhold, power a door, …). Idempotent-safe. */
  onFix: () => void;
  /** Restore the broken look + undo the effect (for reset). */
  onBreak: () => void;
}

class PaintFieldImpl implements PaintField {
  private readonly scene: Scene;
  private readonly registry: HandholdRegistry;
  private readonly targets: Target[] = [];
  private readonly meshToId = new Map<unknown, string>();
  private current: ScenarioName = "none";

  constructor(scene: Scene, registry: HandholdRegistry) {
    this.scene = scene;
    this.registry = registry;
    this.buildFrostGap();
    // Start with nothing shown; main.ts (headed play) or a capture arms a
    // scenario explicitly.
    this.setScenario("none");
  }

  // ---- scenario: "frostgap" -------------------------------------------------
  // Two broken surfaces gate the far console:
  //   access-rail  (cold)       -> frosts into a grabbable handhold across the void
  //   power-conduit(conductive) -> re-powers the console door
  private buildFrostGap(): void {
    this.addRailTarget();
    this.addConduitTarget();
  }

  /** A dead access rail arcing across the room; freeze it COLD to cross. */
  private addRailTarget(): void {
    // Centerline arcs from near the spawn (-Z) to just short of the goal (+Z).
    // The +Z end sits inside the goal win-radius so a pure grab->pull wins.
    const path: Vec3[] = [
      [0, 1.2, -6],
      [0, 1.7, 1],
      [0, 1.1, 7.4],
    ];
    const sheath = MeshBuilder.CreateTube(
      "paint:access-rail",
      {
        path: path.map((p) => new Vector3(p[0], p[1], p[2])),
        radius: 0.16,
        tessellation: 12,
        cap: 2,
        updatable: false,
      },
      this.scene,
    );
    const mat = new StandardMaterial("paint:access-rail:mat", this.scene);
    sheath.material = mat;
    sheath.checkCollisions = false; // repaired via paint, not by bumping into it
    sheath.isPickable = true;

    let handholdId: string | null = null;
    const target: Target = {
      id: "access-rail",
      label: "Access rail",
      required: "cold",
      painted: null,
      mesh: sheath,
      mat,
      extras: [],
      onFix: () => {
        // Frost look + register the analytic handhold used by grab/pull. Slightly
        // thinner than the icy sheath so it reads as an energized core.
        applyFixedLook(mat, PROP_COLOR.cold);
        if (handholdId === null) {
          handholdId = this.registry.freeze(path, 0.1);
        }
      },
      onBreak: () => {
        applyBrokenLook(mat);
        handholdId = null; // registry.clear() (in reset) already removed the tube
      },
    };
    this.registerTarget(target);
  }

  /** A dead power conduit by the console; make it CONDUCTIVE to open the door. */
  private addConduitTarget(): void {
    const panel = MeshBuilder.CreateBox(
      "paint:power-conduit",
      { width: 1.2, height: 1.6, depth: 0.12 },
      this.scene,
    );
    panel.position.set(3, 1.6, 9.6);
    panel.checkCollisions = false;
    panel.isPickable = true;
    const mat = new StandardMaterial("paint:power-conduit:mat", this.scene);
    panel.material = mat;

    // The "door" the conduit powers: a slab beside the console that lights up.
    const door = MeshBuilder.CreateBox(
      "paint:console-door",
      { width: 2.4, height: 3.2, depth: 0.1 },
      this.scene,
    );
    door.position.set(0, 1.6, 9.7);
    door.checkCollisions = false;
    door.isPickable = false;
    const doorMat = new StandardMaterial("paint:console-door:mat", this.scene);
    door.material = doorMat;

    const target: Target = {
      id: "power-conduit",
      label: "Power conduit",
      required: "conductive",
      painted: null,
      mesh: panel,
      mat,
      extras: [door],
      onFix: () => {
        applyFixedLook(mat, PROP_COLOR.conductive);
        doorMat.diffuseColor = new Color3(0.1, 0.5, 0.3);
        doorMat.emissiveColor = new Color3(0.12, 0.7, 0.4); // powered green
      },
      onBreak: () => {
        applyBrokenLook(mat);
        doorMat.diffuseColor = new Color3(0.1, 0.11, 0.13);
        doorMat.emissiveColor = new Color3(0.02, 0.02, 0.03); // dark / unpowered
      },
    };
    this.registerTarget(target);
  }

  private registerTarget(t: Target): void {
    this.targets.push(t);
    this.meshToId.set(t.mesh, t.id);
    t.onBreak();
  }

  // ---- public API -----------------------------------------------------------

  setScenario(name: ScenarioName): void {
    this.current = name;
    const show = name === "frostgap";
    for (const t of this.targets) {
      t.mesh.setEnabled(show);
      for (const e of t.extras) e.setEnabled(show);
    }
    this.reset();
  }

  scenario(): ScenarioName {
    return this.current;
  }

  reset(): void {
    for (const t of this.targets) {
      t.painted = null;
      t.onBreak();
    }
  }

  paint(id: string, property: PaintProperty): boolean {
    if (this.current !== "frostgap") return false;
    const t = this.targets.find((x) => x.id === id);
    if (!t) return false;
    if (property === t.required) {
      if (t.painted !== t.required) {
        t.painted = property;
        t.onFix();
      }
      return true;
    }
    // Wrong property: rejected. State is unchanged; flare the surface red so the
    // mistake is legible (visual only — never part of the simulation).
    if (t.painted === null) t.mat.emissiveColor = REJECT_EMISSIVE.clone();
    return false;
  }

  complete(): boolean {
    if (this.current !== "frostgap") return true;
    return this.targets.every((t) => t.painted === t.required);
  }

  states(): PaintSurfaceState[] {
    if (this.current !== "frostgap") return [];
    return this.targets.map((t) => ({
      id: t.id,
      label: t.label,
      required: t.required,
      painted: t.painted,
      satisfied: t.painted === t.required,
    }));
  }

  pickables(): Mesh[] {
    if (this.current !== "frostgap") return [];
    return this.targets.map((t) => t.mesh);
  }

  idForMesh(mesh: unknown): string | null {
    return this.meshToId.get(mesh) ?? null;
  }
}

function applyBrokenLook(mat: StandardMaterial): void {
  mat.diffuseColor = BROKEN_DIFFUSE.clone();
  mat.emissiveColor = BROKEN_EMISSIVE.clone();
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.alpha = 0.55; // glitchy, half-there
}

function applyFixedLook(mat: StandardMaterial, tint: Color3): void {
  mat.diffuseColor = tint.scale(0.4);
  mat.emissiveColor = tint.clone();
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  mat.alpha = 1;
}

export function createPaintField(
  scene: Scene,
  registry: HandholdRegistry,
): PaintField {
  return new PaintFieldImpl(scene, registry);
}
