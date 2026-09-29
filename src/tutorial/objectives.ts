// src/tutorial/objectives.ts
// Room objectives: each room is an ordered list of STEPS. A step has a coach
// prompt (worded for touch or desktop), a completion check over GameState, and
// an optional BEACON — a glowing marker in the room showing where to go or
// what to look at. Steps advance in fixed-step time (deterministic, driven by
// the same pump as the sim); when the last one is done the room is clear and
// the exit door opens.
//
// The first four rooms are a tutorial (look + float, grab + pull, mag boots,
// boots jump); the paint rooms reuse the same system for light coaching.
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { GameState, Vec3 } from "../types";
import type { HandholdRegistry } from "../drawing/drawing";
import type { ScenarioName } from "../paint/paintField";

type Mem = Record<string, unknown>;

export interface Step {
  /** Coach prompt: [touch wording, desktop wording]. */
  prompt: [string, string];
  /** True once the step is satisfied. `mem` is scratch state for this step. */
  done(s: GameState, mem: Mem): boolean;
  /** Where to go / what to look at, if anything. */
  beacon?: Vec3;
  /** Surface normal for a beacon painted ON a surface (a glowing spot). */
  beaconNormal?: Vec3;
  /** Short label for the on-screen marker (default "GO"). */
  label?: string;
}

interface RoomScript {
  steps: Step[];
  /** Coaching only: the prompts guide, but the room clears when every surface
   *  is repaired (a player may solve it in another order). */
  coachOnly?: boolean;
  /** Props to (re)build after every reset (e.g. a ready-made rail). */
  setup?(registry: HandholdRegistry): void;
}

export interface ObjectiveState {
  step: number;
  total: number;
  prompt: string;
  beacon: Vec3 | null;
  label: string;
}

// ---- small helpers over GameState -------------------------------------------

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const planted = (s: GameState): boolean => s.booted && !s.airborne;
const on = (s: GameState, n: Vec3): boolean =>
  planted(s) && s.surfaceNormal[0] * n[0] + s.surfaceNormal[1] * n[1] + s.surfaceNormal[2] * n[2] > 0.9;
/** Looking within ~11 degrees of point `p`. */
const lookingAt = (s: GameState, p: Vec3): boolean => {
  const d: Vec3 = [p[0] - s.playerPos[0], p[1] - s.playerPos[1], p[2] - s.playerPos[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const v = s.view;
  return (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / l > 0.98;
};
const reach = (p: Vec3, r = 1.3) => (s: GameState) => dist(s.playerPos, p) < r;

const FLOOR: Vec3 = [0, 1, 0];
const CEIL: Vec3 = [0, -1, 0];
const WALL_PX: Vec3 = [-1, 0, 0];

// The ready-made rail in the grab room (same arc as the Frost Gap rail).
const RAIL: Vec3[] = [
  [0, 1.2, -6],
  [0, 1.7, 1],
  [0, 1.1, 7.4],
];

const ROOMS: Partial<Record<ScenarioName, RoomScript>> = {
  // 1 — look around + float.
  wakeup: {
    steps: [
      {
        prompt: [
          "You're awake — and floating. Drag the RIGHT stick to look at the blinking light.",
          "You're awake — and floating. Move the mouse to look at the blinking light (click to capture it).",
        ],
        beacon: [-7.4, 3, -3],
        label: "LOOK",
        done: (s) => lookingAt(s, [-7.4, 3, -3]),
      },
      {
        prompt: [
          "Now this one. Hold the right stick near its edge to keep turning.",
          "Now look at this one.",
        ],
        beacon: [7.4, 2.4, -1],
        label: "LOOK",
        done: (s) => lookingAt(s, [7.4, 2.4, -1]),
      },
      {
        prompt: ["And up here.", "And up here."],
        beacon: [0, 5.4, -4],
        label: "LOOK",
        done: (s) => lookingAt(s, [0, 5.4, -4]),
      },
      {
        prompt: [
          "Push the LEFT stick to fly toward the beacon. You drift in zero-g — let go to coast.",
          "Hold W to fly toward the beacon (A/D strafe, S brakes). You drift in zero-g.",
        ],
        beacon: [0, 2.2, 0],
        done: reach([0, 2.2, 0], 1.4),
      },
      {
        prompt: ["Fly to the beacon by the door.", "Fly to the beacon by the door."],
        beacon: [0, 1.5, 7.2],
        done: reach([0, 1.5, 7.2], 1.4),
      },
    ],
  },

  // 2 — grab + pull along a handhold.
  handhold: {
    setup: (registry) => void registry.freeze(RAIL, 0.1),
    steps: [
      {
        prompt: [
          "Handholds let you travel without thrusting. Fly to the start of the orange rail.",
          "Handholds let you travel without thrusting. Fly to the start of the orange rail.",
        ],
        beacon: [0, 1.2, -6],
        done: reach([0, 1.2, -6], 1.0),
      },
      {
        prompt: ["Tap GRAB to hold on.", "Press Space to grab the rail."],
        done: (s) => s.grabbing,
      },
      {
        prompt: [
          "Push the LEFT stick forward to pull yourself along, hand over hand.",
          "Hold W to pull yourself along, hand over hand.",
        ],
        beacon: RAIL[2],
        done: (s) => (s.grabT ?? 0) > 0.97,
      },
      {
        prompt: [
          "Tap RELEASE, then float to the beacon.",
          "Press Space to let go, then float to the beacon.",
        ],
        beacon: [0, 1.5, 8.4],
        done: (s) => !s.grabbing && dist(s.playerPos, [0, 1.5, 8.4]) < 1.2,
      },
    ],
  },

  // 3 — mag boots: stick to the ceiling, walk across it and down a wall.
  boots: {
    steps: [
      {
        prompt: [
          "Mag boots stick you to any surface. First, fly up to the ceiling.",
          "Mag boots stick you to any surface. First, fly up to the ceiling (look up, hold W).",
        ],
        beacon: [0, 5.2, -5],
        beaconNormal: CEIL,
        done: (s) => s.playerPos[1] > 3.9,
      },
      {
        prompt: [
          "Tap BOOTS — you'll plant on the ceiling, and it becomes your floor.",
          "Press B — you'll plant on the ceiling, and it becomes your floor.",
        ],
        done: (s) => on(s, CEIL),
      },
      {
        prompt: [
          "Walk across the ceiling to the glowing spot (left stick).",
          "Walk across the ceiling to the glowing spot (WASD).",
        ],
        beacon: [3, 5.95, 2],
        beaconNormal: CEIL,
        label: "WALK",
        done: (s) => on(s, CEIL) && Math.hypot(s.playerPos[0] - 3, s.playerPos[2] - 2) < 1.3,
      },
      {
        prompt: [
          "Keep walking off the edge onto the right wall — it just becomes the floor.",
          "Keep walking off the edge onto the right wall — it just becomes the floor.",
        ],
        beacon: [7.95, 3.2, 2],
        beaconNormal: WALL_PX,
        label: "WALK",
        done: (s) => on(s, WALL_PX),
      },
      {
        prompt: [
          "Walk down the wall to the glowing spot on the floor.",
          "Walk down the wall to the glowing spot on the floor.",
        ],
        beacon: [5.5, 0.05, 2],
        beaconNormal: FLOOR,
        label: "WALK",
        done: (s) => on(s, FLOOR) && Math.hypot(s.playerPos[0] - 5.5, s.playerPos[2] - 2) < 1.4,
      },
    ],
  },

  // 4 — boots jump.
  hop: {
    steps: [
      {
        prompt: ["Tap BOOTS to stand on the floor.", "Press B to stand on the floor."],
        done: (s) => on(s, FLOOR),
      },
      {
        prompt: [
          "Tap JUMP. Your boots stay on — you'll come back down.",
          "Press Space to jump. Your boots stay on — you'll come back down.",
        ],
        done: (s, m) => {
          if (s.airborne) m.up = true;
          return m.up === true && planted(s);
        },
      },
      {
        prompt: [
          "Walk to the glowing spot beside the wall, then JUMP — you'll land on the wall.",
          "Walk to the glowing spot beside the wall, then press Space — you'll land on the wall.",
        ],
        beacon: [7.1, 0.05, -2],
        beaconNormal: FLOOR,
        label: "JUMP",
        done: (s) => on(s, WALL_PX),
      },
      {
        prompt: ["Walk up the wall to the beacon.", "Walk up the wall to the beacon."],
        beacon: [7.95, 4.4, -2],
        beaconNormal: WALL_PX,
        label: "WALK",
        done: (s) => on(s, WALL_PX) && Math.hypot(s.playerPos[1] - 4.4, s.playerPos[2] + 2) < 1.3,
      },
    ],
  },

  // 5 — first paint puzzle (light coaching).
  frostgap: {
    coachOnly: true,
    steps: [
      {
        prompt: [
          "Broken surfaces show a symptom. The rail is overheated — pick the property that fixes it, walk up, tap PAINT and trace the glyph.",
          "Broken surfaces show a symptom. The rail is overheated — pick a property (1/2/3), get close, press F and trace the glyph.",
        ],
        done: (s) => !!s.paintSurfaces.find((p) => p.id === "access-rail")?.satisfied,
      },
      {
        prompt: [
          "The rail's a handhold now. Grab it and pull yourself across the gap.",
          "The rail's a handhold now. Grab it (Space) and pull yourself across (W).",
        ],
        done: (s) => s.playerPos[2] > 5,
      },
      {
        prompt: ["Now fix the power conduit.", "Now fix the power conduit."],
        done: (s) => s.paintComplete && s.paintSurfaces.length > 0,
      },
    ],
  },

  // 6 — ordered repairs.
  crosswire: {
    coachOnly: true,
    steps: [
      {
        prompt: [
          "Some surfaces are blocked by others. Repair them in the right order.",
          "Some surfaces are blocked by others. Repair them in the right order.",
        ],
        done: (s) => s.paintComplete && s.paintSurfaces.length > 0,
      },
    ],
  },
};

const BEACON_COLOR = new Color3(1.0, 0.78, 0.25);

export interface Objectives {
  setRoom(name: ScenarioName): void;
  /** Rebuild room props + restart at step 1 (call after the registry is cleared). */
  reset(): void;
  /** Advance through any satisfied steps (fixed-step). */
  update(s: GameState): void;
  /** True when this room has a script and every step is done. */
  complete(): boolean;
  hasScript(): boolean;
  /** The script only coaches (clearing is decided by the paint repairs). */
  coachOnly(): boolean;
  state(): ObjectiveState | null;
}

class ObjectivesImpl implements Objectives {
  private script: RoomScript | null = null;
  private idx = 0;
  private mem: Mem = {};
  private readonly beacon: Mesh;
  private readonly spot: Mesh;
  private readonly mat: StandardMaterial;
  private t = 0;

  constructor(
    private readonly scene: Scene,
    private readonly registry: HandholdRegistry,
    private readonly touch: boolean,
  ) {
    this.mat = new StandardMaterial("beaconMat", scene);
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.emissiveColor = BEACON_COLOR.clone();
    this.mat.alpha = 0.9;
    this.beacon = MeshBuilder.CreateSphere("beacon", { diameter: 0.45, segments: 16 }, scene);
    this.spot = MeshBuilder.CreateTorus("beaconSpot", { diameter: 1.4, thickness: 0.12, tessellation: 32 }, scene);
    for (const m of [this.beacon, this.spot]) {
      m.material = this.mat;
      m.isPickable = false;
      m.checkCollisions = false;
      m.setEnabled(false);
    }
    // Visual-only pulse (never read by the sim).
    scene.onBeforeRenderObservable.add(() => {
      this.t += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
      const k = 0.55 + 0.45 * Math.sin(this.t * 5);
      this.mat.emissiveColor.set(BEACON_COLOR.r * k + 0.1, BEACON_COLOR.g * k + 0.05, BEACON_COLOR.b * k);
      const sc = 1 + 0.12 * Math.sin(this.t * 5);
      this.beacon.scaling.setAll(sc);
      this.spot.scaling.setAll(sc);
    });
  }

  setRoom(name: ScenarioName): void {
    this.script = ROOMS[name] ?? null;
  }

  reset(): void {
    this.idx = 0;
    this.mem = {};
    this.script?.setup?.(this.registry);
    this.showBeacon();
  }

  update(s: GameState): void {
    const sc = this.script;
    if (!sc) return;
    let moved = false;
    while (this.idx < sc.steps.length && sc.steps[this.idx].done(s, this.mem)) {
      this.idx++;
      this.mem = {};
      moved = true;
    }
    if (moved) this.showBeacon();
  }

  complete(): boolean {
    return !!this.script && this.idx >= this.script.steps.length;
  }

  hasScript(): boolean {
    return !!this.script;
  }

  coachOnly(): boolean {
    return !!this.script?.coachOnly;
  }

  state(): ObjectiveState | null {
    const sc = this.script;
    if (!sc || this.idx >= sc.steps.length) return null;
    const st = sc.steps[this.idx];
    return {
      step: this.idx + 1,
      total: sc.steps.length,
      prompt: st.prompt[this.touch ? 0 : 1],
      beacon: st.beacon ? [st.beacon[0], st.beacon[1], st.beacon[2]] : null,
      label: st.label ?? "GO",
    };
  }

  private showBeacon(): void {
    const st = this.script && this.idx < this.script.steps.length ? this.script.steps[this.idx] : null;
    this.beacon.setEnabled(false);
    this.spot.setEnabled(false);
    if (!st?.beacon) return;
    const [x, y, z] = st.beacon;
    if (st.beaconNormal) {
      // A glowing ring lying on the surface (torus axis = its normal).
      const n = st.beaconNormal;
      this.spot.position.set(x + n[0] * 0.3, y + n[1] * 0.3, z + n[2] * 0.3);
      this.spot.rotation.set(n[2] !== 0 ? Math.PI / 2 : 0, 0, n[0] !== 0 ? Math.PI / 2 : 0);
      this.spot.setEnabled(true);
    } else {
      this.beacon.position.set(x, y, z);
      this.beacon.setEnabled(true);
    }
  }
}

export function createObjectives(scene: Scene, registry: HandholdRegistry, touch: boolean): Objectives {
  return new ObjectivesImpl(scene, registry, touch);
}
