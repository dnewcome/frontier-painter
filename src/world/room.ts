// src/world/room.ts
// Builds the single sealed zero-g room: six interior walls as static collidable
// meshes (checkCollisions = true), a hemispheric ambient fill light, and the
// emissive goal marker. Owns the deterministic player spawn and the goal
// win-test. Purely procedural geometry; no external assets.
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Vec3, SimConfig } from "../types";
import { createGoal, type Goal } from "./goal";

export interface World {
  readonly goal: Goal;
  /** Deterministic player spawn (mirrors config.spawn). */
  readonly spawn: Vec3;
  /** Reset goal latch + visual state. */
  reset(): void;
}

// Interior room dimensions (meters): 16 (X) x 6 (Y) x 20 (Z).
const ROOM_X = 16;
const ROOM_Y = 6;
const ROOM_Z = 20;
const WALL_T = 0.5;

// Goal sphere center. Sits near the far (+Z) end so the player must bridge the
// open volume with a drawn handhold to reach it.
const GOAL_POSITION: Vec3 = [0, 1, 8];

class WorldImpl implements World {
  readonly goal: Goal;
  readonly spawn: Vec3;

  constructor(scene: Scene, config: SimConfig) {
    // Copy so the spawn we expose can't be mutated through the config object.
    const s = config.spawn;
    this.spawn = [s[0], s[1], s[2]];

    // Hemispheric ambient fill so the whole interior is legible from any angle.
    const light = new HemisphericLight("ambient", new Vector3(0.2, 1, 0.1), scene);
    light.intensity = 0.95;
    light.groundColor = new Color3(0.25, 0.28, 0.35);

    // Shared wall material. Walls are viewed from the inside, so disable
    // back-face culling and keep specular low to read as matte hull plating.
    const wallMat = new StandardMaterial("wallMat", scene);
    wallMat.diffuseColor = new Color3(0.45, 0.48, 0.55);
    wallMat.specularColor = new Color3(0.05, 0.05, 0.05);
    wallMat.backFaceCulling = false;

    const cx = 0;
    const cy = ROOM_Y / 2;
    const cz = 0;

    // Six walls as thin, static, collidable boxes enclosing the interior. They
    // never move, so freeze their world matrices for cheap, stable collisions.
    const makeWall = (
      name: string,
      w: number,
      h: number,
      d: number,
      px: number,
      py: number,
      pz: number,
    ): void => {
      const wall = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      wall.position.set(px, py, pz);
      wall.material = wallMat;
      wall.checkCollisions = true;
      wall.freezeWorldMatrix();
    };

    // Floor & ceiling.
    makeWall("floor", ROOM_X, WALL_T, ROOM_Z, cx, 0, cz);
    makeWall("ceiling", ROOM_X, WALL_T, ROOM_Z, cx, ROOM_Y, cz);
    // -X / +X side walls.
    makeWall("wallNegX", WALL_T, ROOM_Y, ROOM_Z, cx - ROOM_X / 2, cy, cz);
    makeWall("wallPosX", WALL_T, ROOM_Y, ROOM_Z, cx + ROOM_X / 2, cy, cz);
    // -Z / +Z end walls.
    makeWall("wallNegZ", ROOM_X, ROOM_Y, WALL_T, cx, cy, cz - ROOM_Z / 2);
    makeWall("wallPosZ", ROOM_X, ROOM_Y, WALL_T, cx, cy, cz + ROOM_Z / 2);

    // Goal marker (emissive sphere) near the far end.
    this.goal = createGoal(scene, GOAL_POSITION, config.goalRadius);
  }

  reset(): void {
    this.goal.reset();
  }
}

/** Creates collidable room walls, lights, and the goal marker. */
export function createWorld(scene: Scene, config: SimConfig): World {
  return new WorldImpl(scene, config);
}
