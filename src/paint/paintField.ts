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
// INTERACTION (room 2): a target may have a `prerequisite` — another target that
// must be repaired first. Until then the target is INACCESSIBLE: even its correct
// property is rejected (a distinct "locked" flare), and a target flagged
// `hiddenUntilPrereq` is not even present until its prerequisite is repaired
// (e.g. frosting a coolant shroud RETRACTS it, revealing the conduit behind it).
// This makes the puzzle "right property, right place, right ORDER".
//
// Determinism: paint() is a pure state transition + mesh/material mutation and a
// deterministic registry.freeze() (no Math.random / Date.now / time reads), so it
// is safe to call from the scripted window.game path. Material tints are visual
// only (rendered, never part of the fixed-step simulation). The active scenario
// is chosen by setScenario(): only its targets are shown, so the legacy
// magnetic-boots slice runs in the original empty room ("none"), untouched.
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vec3, PaintProperty, PaintSurfaceState } from "../types";
import type { HandholdRegistry } from "../drawing/drawing";

/** Named scenarios. "none" = empty room (legacy boots slice). */
export type ScenarioName = "none" | "frostgap" | "crosswire";

/** Emissive tint per property, for the "fixed" look + HUD swatches. */
export const PROP_COLOR: Record<PaintProperty, Color3> = {
  cold: new Color3(0.55, 0.85, 1.0), // frost blue-white
  conductive: new Color3(1.0, 0.66, 0.16), // copper / amber
  magnetic: new Color3(0.72, 0.42, 1.0), // violet
};

const BROKEN_DIFFUSE = new Color3(0.16, 0.17, 0.2);
const BROKEN_EMISSIVE = new Color3(0.05, 0.06, 0.08);
const REJECT_EMISSIVE = new Color3(0.6, 0.06, 0.06); // wrong property
const LOCKED_EMISSIVE = new Color3(0.5, 0.42, 0.05); // right idea, wrong order

export interface PaintField {
  /** Serializable state of every KNOWN target in the active scenario (else []). */
  states(): PaintSurfaceState[];
  /** Paint target `id` with `property`. True iff it repaired (correct) it. */
  paint(id: string, property: PaintProperty): boolean;
  /** True when every armed target is satisfied (vacuously true when unarmed). */
  complete(): boolean;
  /** Meshes a human aim-ray may target (visible targets in the active scenario). */
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
  /** Another target id that must be repaired before this one accepts paint. */
  prerequisite: string | null;
  /** If true, this target is hidden (mesh disabled, absent from states) until
   *  its prerequisite is repaired, then it is REVEALED. */
  hiddenUntilPrereq: boolean;
  /** True once revealed (always true for non-hidden targets). */
  revealed: boolean;
  /** The pickable placeholder mesh (the visible "broken surface"). */
  mesh: Mesh;
  mat: StandardMaterial;
  /** Extra effect meshes shown/hidden with the scenario. */
  extras: Mesh[];
  /** Repair effect (register a handhold, power a door, retract a shroud, …). */
  onFix: () => void;
  /** Restore the broken look + undo the effect (for reset). */
  onBreak: () => void;
}

class PaintFieldImpl implements PaintField {
  private readonly scene: Scene;
  private readonly registry: HandholdRegistry;
  /** All targets across all scenarios, tagged by owning scenario. */
  private readonly byScenario = new Map<ScenarioName, Target[]>();
  private readonly meshToId = new Map<unknown, string>();
  private current: ScenarioName = "none";

  constructor(scene: Scene, registry: HandholdRegistry) {
    this.scene = scene;
    this.registry = registry;
    this.byScenario.set("frostgap", this.buildFrostGap());
    this.byScenario.set("crosswire", this.buildCrosswire());
    this.setScenario("none");
  }

  // ---- scenario builders ----------------------------------------------------

  /** Room 1 — two INDEPENDENT surfaces gate the console. */
  private buildFrostGap(): Target[] {
    return [this.makeRailTarget(), this.makeConduitTarget()];
  }

  /** Room 2 — an ordered CHAIN: cold reveals a conduit you then make conductive. */
  private buildCrosswire(): Target[] {
    return this.makeCrosswireChain();
  }

  /** A dead access rail arcing across the room; freeze it COLD to cross. */
  private makeRailTarget(): Target {
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
    sheath.checkCollisions = false;
    sheath.isPickable = true;

    let handholdId: string | null = null;
    const t = this.baseTarget({
      id: "access-rail",
      label: "Access rail",
      required: "cold",
      mesh: sheath,
      mat,
      onFix: () => {
        applyFixedLook(mat, PROP_COLOR.cold);
        if (handholdId === null) handholdId = this.registry.freeze(path, 0.1);
      },
      onBreak: () => {
        applyBrokenLook(mat);
        handholdId = null;
      },
    });
    return t;
  }

  /** A dead power conduit by the console; make it CONDUCTIVE to open the door. */
  private makeConduitTarget(): Target {
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

    const door = this.makeDoor("paint:console-door", [0, 1.6, 9.7]);
    const doorMat = door.material as StandardMaterial;

    return this.baseTarget({
      id: "power-conduit",
      label: "Power conduit",
      required: "conductive",
      mesh: panel,
      mat,
      extras: [door],
      onFix: () => {
        applyFixedLook(mat, PROP_COLOR.conductive);
        powerDoor(doorMat, true);
      },
      onBreak: () => {
        applyBrokenLook(mat);
        powerDoor(doorMat, false);
      },
    });
  }

  /** Room 2's ordered chain: coolant shroud (cold) -> reveals power core
   *  (conductive), which powers the console. */
  private makeCrosswireChain(): Target[] {
    // The shroud sits IN FRONT of the core; frosting it retracts it upward,
    // exposing the conductive core behind.
    const shroudHome = new Vector3(-2, 1.7, 9.55);
    const shroud = MeshBuilder.CreateBox(
      "paint:coolant-shroud",
      { width: 1.8, height: 1.8, depth: 0.14 },
      this.scene,
    );
    shroud.position.copyFrom(shroudHome);
    shroud.checkCollisions = false;
    shroud.isPickable = true;
    const shroudMat = new StandardMaterial("paint:coolant-shroud:mat", this.scene);
    shroud.material = shroudMat;

    const core = MeshBuilder.CreateBox(
      "paint:power-core",
      { width: 1.1, height: 1.1, depth: 0.12 },
      this.scene,
    );
    core.position.set(-2, 1.6, 9.75);
    core.checkCollisions = false;
    core.isPickable = true;
    const coreMat = new StandardMaterial("paint:power-core:mat", this.scene);
    core.material = coreMat;

    const door = this.makeDoor("paint:crosswire-door", [0, 1.6, 9.85]);
    const doorMat = door.material as StandardMaterial;

    const shroudTarget = this.baseTarget({
      id: "coolant-shroud",
      label: "Coolant shroud",
      required: "cold",
      mesh: shroud,
      mat: shroudMat,
      onFix: () => {
        applyFixedLook(shroudMat, PROP_COLOR.cold);
        shroud.position.set(shroudHome.x, shroudHome.y + 2.6, shroudHome.z); // retract up
      },
      onBreak: () => {
        applyBrokenLook(shroudMat);
        shroud.position.copyFrom(shroudHome);
      },
    });

    const coreTarget = this.baseTarget({
      id: "power-core",
      label: "Power core",
      required: "conductive",
      prerequisite: "coolant-shroud",
      hiddenUntilPrereq: true,
      mesh: core,
      mat: coreMat,
      extras: [door],
      onFix: () => {
        applyFixedLook(coreMat, PROP_COLOR.conductive);
        powerDoor(doorMat, true);
      },
      onBreak: () => {
        applyBrokenLook(coreMat);
        powerDoor(doorMat, false);
      },
    });

    return [shroudTarget, coreTarget];
  }

  /** Shared "door slab" the powered surface lights up. */
  private makeDoor(name: string, pos: Vec3): Mesh {
    const door = MeshBuilder.CreateBox(
      name,
      { width: 2.4, height: 3.2, depth: 0.1 },
      this.scene,
    );
    door.position.set(pos[0], pos[1], pos[2]);
    door.checkCollisions = false;
    door.isPickable = false;
    door.material = new StandardMaterial(`${name}:mat`, this.scene);
    return door;
  }

  /** Fill in Target defaults + register the pickable mesh id. */
  private baseTarget(spec: {
    id: string;
    label: string;
    required: PaintProperty;
    mesh: Mesh;
    mat: StandardMaterial;
    extras?: Mesh[];
    prerequisite?: string;
    hiddenUntilPrereq?: boolean;
    onFix: () => void;
    onBreak: () => void;
  }): Target {
    const t: Target = {
      id: spec.id,
      label: spec.label,
      required: spec.required,
      painted: null,
      prerequisite: spec.prerequisite ?? null,
      hiddenUntilPrereq: spec.hiddenUntilPrereq ?? false,
      revealed: !(spec.hiddenUntilPrereq ?? false),
      mesh: spec.mesh,
      mat: spec.mat,
      extras: spec.extras ?? [],
      onFix: spec.onFix,
      onBreak: spec.onBreak,
    };
    this.meshToId.set(t.mesh, t.id);
    return t;
  }

  // ---- public API -----------------------------------------------------------

  private active(): Target[] {
    return this.byScenario.get(this.current) ?? [];
  }

  /** A target accepts paint only once its prerequisite (if any) is repaired. */
  private accessible(t: Target): boolean {
    if (!t.prerequisite) return true;
    const pre = this.active().find((x) => x.id === t.prerequisite);
    return !!pre && pre.painted === pre.required;
  }

  setScenario(name: ScenarioName): void {
    this.current = name;
    for (const [scn, targets] of this.byScenario) {
      const show = scn === name;
      for (const t of targets) {
        t.mesh.setEnabled(false);
        for (const e of t.extras) e.setEnabled(show);
      }
    }
    this.reset();
  }

  scenario(): ScenarioName {
    return this.current;
  }

  reset(): void {
    for (const t of this.active()) {
      t.painted = null;
      t.revealed = !t.hiddenUntilPrereq;
      t.onBreak();
      // Visible only if this scenario is active AND the target is revealed.
      t.mesh.setEnabled(t.revealed);
    }
  }

  paint(id: string, property: PaintProperty): boolean {
    const t = this.active().find((x) => x.id === id);
    if (!t) return false;

    // Inaccessible: prerequisite not yet repaired. Reject with a distinct
    // "locked" flare (a hint that the order is wrong), even for the right color.
    if (!this.accessible(t)) {
      if (t.revealed && t.painted === null) t.mat.emissiveColor = LOCKED_EMISSIVE.clone();
      return false;
    }

    if (property === t.required) {
      if (t.painted !== t.required) {
        t.painted = property;
        t.onFix();
        this.revealDependents(t);
      }
      return true;
    }

    // Wrong property: rejected. Flare red (visual only).
    if (t.painted === null) t.mat.emissiveColor = REJECT_EMISSIVE.clone();
    return false;
  }

  /** Reveal any hidden targets whose prerequisite just became satisfied. */
  private revealDependents(justFixed: Target): void {
    for (const t of this.active()) {
      if (t.prerequisite === justFixed.id && !t.revealed) {
        t.revealed = true;
        t.mesh.setEnabled(true);
      }
    }
  }

  complete(): boolean {
    const targets = this.active();
    if (targets.length === 0) return true;
    return targets.every((t) => t.painted === t.required);
  }

  states(): PaintSurfaceState[] {
    // Only surfaces the player can currently perceive (revealed ones).
    return this.active()
      .filter((t) => t.revealed)
      .map((t) => ({
        id: t.id,
        label: t.label,
        required: t.required,
        painted: t.painted,
        satisfied: t.painted === t.required,
        available: this.accessible(t),
      }));
  }

  pickables(): Mesh[] {
    return this.active()
      .filter((t) => t.revealed)
      .map((t) => t.mesh);
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

function powerDoor(mat: StandardMaterial, on: boolean): void {
  if (on) {
    mat.diffuseColor = new Color3(0.1, 0.5, 0.3);
    mat.emissiveColor = new Color3(0.12, 0.7, 0.4); // powered green
  } else {
    mat.diffuseColor = new Color3(0.1, 0.11, 0.13);
    mat.emissiveColor = new Color3(0.02, 0.02, 0.03); // dark / unpowered
  }
}

export function createPaintField(
  scene: Scene,
  registry: HandholdRegistry,
): PaintField {
  return new PaintFieldImpl(scene, registry);
}
