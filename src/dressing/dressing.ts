// src/dressing/dressing.ts
// Purely VISUAL set-dressing that turns the empty sealed room into a clean,
// utilitarian (NASA / ISS-style) spaceship interior. Everything here is
// procedural (geometry + StandardMaterials + canvas DynamicTextures) — NO
// external/binary assets.
//
// HARD RULES honored here:
//  * Every mesh is decoration only: checkCollisions=false, isPickable=false, and
//    world matrices are frozen. The 6 collidable walls (owned by room.ts) are the
//    only colliders, so the player + handholds are unaffected.
//  * The central play volume (x≈0) and the spawn->goal line stay clear; dressing
//    hugs the walls/floor/ceiling and corners.
//  * Layout is DETERMINISTIC: any scatter uses the seeded PRNG from textures.ts,
//    never Math.random / time, so demo frames are reproducible.
//  * Palette is white / grey / dark with COOL accents only — no green / amber /
//    blue dressing that would compete with the blue player, amber handhold, or
//    green/gold goal.
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import {
  makePanelTexture,
  makeGratingTexture,
  makeStarfieldTexture,
  makeLabelTexture,
  makeChevronTexture,
  makeVentTexture,
  mulberry32,
} from "./textures";

export interface DressingOptions {
  /** Interior box dimensions (m); defaults match src/world/room.ts. */
  roomX: number;
  roomY: number;
  roomZ: number;
  wallThickness: number;
}

export interface Dressing {
  dispose(): void;
}

const DEFAULTS: DressingOptions = {
  roomX: 16,
  roomY: 6,
  roomZ: 20,
  wallThickness: 0.5,
};

/** Decorates the existing room. Call AFTER the room + goal are built. */
export function createDressing(
  scene: Scene,
  opts: Partial<DressingOptions> = {},
): Dressing {
  const o: DressingOptions = { ...DEFAULTS, ...opts };
  const meshes: Mesh[] = [];

  // Inner face coordinates of the sealed box.
  const ix = o.roomX / 2 - o.wallThickness / 2; // |x| of inner side walls
  const iz = o.roomZ / 2 - o.wallThickness / 2; // |z| of inner end walls
  const floorTop = o.wallThickness / 2; // y of inner floor surface
  const ceilBot = o.roomY - o.wallThickness / 2; // y of inner ceiling surface

  // -- Shared materials -----------------------------------------------------
  const metalMat = new StandardMaterial("dr_metal", scene);
  metalMat.diffuseColor = new Color3(0.7, 0.73, 0.78);
  metalMat.specularColor = new Color3(0.3, 0.32, 0.36);

  const darkMat = new StandardMaterial("dr_dark", scene);
  darkMat.diffuseColor = new Color3(0.3, 0.33, 0.38);
  darkMat.specularColor = new Color3(0.12, 0.12, 0.14);

  const frameMat = new StandardMaterial("dr_frame", scene);
  frameMat.diffuseColor = new Color3(0.16, 0.18, 0.22);
  frameMat.specularColor = new Color3(0.1, 0.1, 0.12);

  const stripMat = new StandardMaterial("dr_strip", scene);
  stripMat.diffuseColor = new Color3(0.05, 0.05, 0.06);
  stripMat.emissiveColor = new Color3(0.85, 0.92, 1.0); // cool white light
  stripMat.specularColor = new Color3(0, 0, 0);

  // Starfield viewport "glass". The procedural starfield is a near-black canvas
  // with bright star pixels; driven as a DIFFUSE texture under the bright
  // hemispheric fill it reads as glowing space (the emissive-texture sampling
  // path is tree-shaken out of this StandardMaterial build, so diffuse is the
  // robust choice). Specular off so it stays a flat dark "window".
  const starTex = makeStarfieldTexture(scene, "dr_starTex");
  const starMat = new StandardMaterial("dr_star", scene);
  starMat.diffuseColor = new Color3(1, 1, 1);
  starMat.diffuseTexture = starTex;
  starMat.specularColor = new Color3(0, 0, 0);
  starMat.emissiveColor = new Color3(0, 0, 0);
  starMat.backFaceCulling = false;

  // -- helpers --------------------------------------------------------------
  const tag = (m: Mesh): Mesh => {
    m.checkCollisions = false;
    m.isPickable = false;
    m.freezeWorldMatrix();
    meshes.push(m);
    return m;
  };

  const panelMat = (name: string, uScale: number, vScale: number): StandardMaterial => {
    const mat = new StandardMaterial(name, scene);
    const tex = makePanelTexture(scene, name + "Tex");
    tex.uScale = uScale;
    tex.vScale = vScale;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    mat.diffuseTexture = tex;
    mat.specularColor = new Color3(0.06, 0.06, 0.07);
    mat.backFaceCulling = false;
    return mat;
  };

  const labelPlane = (
    name: string,
    l1: string,
    l2: string,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    rotY: number,
  ): void => {
    const mat = new StandardMaterial(name, scene);
    const tex = makeLabelTexture(scene, name + "Tex", l1, l2);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new Color3(0.18, 0.19, 0.22); // keep stencil legible
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    const p = MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
    p.material = mat;
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    tag(p);
  };

  // -- WALL / FLOOR / CEILING SKINS ----------------------------------------
  // Side walls (face inward; backFaceCulling off so orientation is harmless).
  const sideU = o.roomZ / 2; // one panel cell == 2 m
  {
    // Inset panels 2 cm off the wall so they are NOT coplanar with the collidable
    // wall surface (coplanar faces z-fight and flicker as the camera moves).
    const px = MeshBuilder.CreatePlane("dr_wallPosX", { width: o.roomZ, height: o.roomY }, scene);
    px.material = panelMat("dr_panelPosX", sideU, 1);
    px.position.set(ix - 0.02, o.roomY / 2, 0);
    px.rotation.y = -Math.PI / 2;
    tag(px);

    const nx = MeshBuilder.CreatePlane("dr_wallNegX", { width: o.roomZ, height: o.roomY }, scene);
    nx.material = panelMat("dr_panelNegX", sideU, 1);
    nx.position.set(-ix + 0.02, o.roomY / 2, 0);
    nx.rotation.y = Math.PI / 2;
    tag(nx);
  }
  // End walls.
  const endU = o.roomX / 2;
  {
    const pz = MeshBuilder.CreatePlane("dr_wallPosZ", { width: o.roomX, height: o.roomY }, scene);
    pz.material = panelMat("dr_panelPosZ", endU, 1);
    pz.position.set(0, o.roomY / 2, iz - 0.02);
    pz.rotation.y = Math.PI;
    tag(pz);

    const nz = MeshBuilder.CreatePlane("dr_wallNegZ", { width: o.roomX, height: o.roomY }, scene);
    nz.material = panelMat("dr_panelNegZ", endU, 1);
    nz.position.set(0, o.roomY / 2, -iz + 0.02);
    tag(nz);
  }
  // Ceiling panels.
  {
    const ceil = MeshBuilder.CreateGround(
      "dr_ceiling",
      { width: o.roomX, height: o.roomZ },
      scene,
    );
    const mat = panelMat("dr_panelCeil", o.roomX / 2, o.roomZ / 2);
    mat.diffuseTexture!.wrapV = Texture.WRAP_ADDRESSMODE;
    ceil.material = mat;
    ceil.position.set(0, ceilBot - 0.01, 0);
    ceil.rotation.x = Math.PI; // face downward
    tag(ceil);
  }
  // Floor grating.
  {
    const grateMat = new StandardMaterial("dr_grateMat", scene);
    const tex = makeGratingTexture(scene, "dr_grateTex");
    tex.uScale = o.roomX / 2;
    tex.vScale = o.roomZ / 2;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    grateMat.diffuseTexture = tex;
    grateMat.specularColor = new Color3(0.15, 0.16, 0.18);
    const floor = MeshBuilder.CreateGround(
      "dr_floor",
      { width: o.roomX, height: o.roomZ },
      scene,
    );
    floor.material = grateMat;
    floor.position.set(0, floorTop + 0.01, 0);
    tag(floor);
  }

  // -- RECESSED CEILING LIGHT STRIPS (emissive) ----------------------------
  for (const lx of [-4, 0, 4]) {
    const strip = MeshBuilder.CreateBox(
      `dr_light_${lx}`,
      { width: 0.5, height: 0.12, depth: o.roomZ * 0.7 },
      scene,
    );
    strip.material = stripMat;
    strip.position.set(lx, ceilBot - 0.08, 0);
    tag(strip);
  }

  // -- HANDRAILS / GRAB-BARS along side walls ------------------------------
  const railLen = o.roomZ * 0.8;
  const makeRail = (xWall: number, sign: number, yRail: number): void => {
    const railX = xWall - sign * 0.55; // standoff from wall toward interior
    const rail = MeshBuilder.CreateCylinder(
      `dr_rail_${sign}_${yRail}`,
      { height: railLen, diameter: 0.1, tessellation: 12 },
      scene,
    );
    rail.material = metalMat;
    rail.rotation.x = Math.PI / 2; // run along Z
    rail.position.set(railX, yRail, 0);
    tag(rail);
    // Standoff posts back to the wall.
    for (const z of [-6, -2, 2, 6]) {
      const post = MeshBuilder.CreateCylinder(
        `dr_post_${sign}_${yRail}_${z}`,
        { height: 0.55, diameter: 0.06, tessellation: 8 },
        scene,
      );
      post.material = metalMat;
      post.rotation.z = Math.PI / 2; // run along X
      post.position.set(xWall - sign * 0.28, yRail, z);
      tag(post);
    }
  };
  makeRail(ix, 1, 1.3);
  makeRail(ix, 1, 2.7);
  makeRail(-ix, -1, 1.3);
  makeRail(-ix, -1, 2.7);

  // -- CONDUIT / PIPE RUNS along the upper wall corners --------------------
  const makePipe = (x: number, y: number, dia: number): void => {
    const pipe = MeshBuilder.CreateCylinder(
      `dr_pipe_${x}_${y}`,
      { height: o.roomZ * 0.92, diameter: dia, tessellation: 14 },
      scene,
    );
    pipe.material = darkMat;
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, y, 0);
    tag(pipe);
  };
  makePipe(ix - 0.35, ceilBot - 0.5, 0.2);
  makePipe(ix - 0.7, ceilBot - 0.5, 0.14);
  makePipe(-ix + 0.35, ceilBot - 0.5, 0.2);

  // -- EQUIPMENT RACKS / GREEBLE BOXES (seeded, deterministic) -------------
  const ventTex = makeVentTexture(scene, "dr_ventTex");
  const rackMat = new StandardMaterial("dr_rackMat", scene);
  rackMat.diffuseColor = new Color3(0.34, 0.37, 0.42);
  rackMat.specularColor = new Color3(0.1, 0.1, 0.12);
  const rackVentMat = new StandardMaterial("dr_rackVentMat", scene);
  rackVentMat.diffuseTexture = ventTex;
  rackVentMat.specularColor = new Color3(0.1, 0.1, 0.12);

  const rnd = mulberry32(424242);
  const placeRacks = (xWall: number, sign: number, zSlots: number[]): void => {
    for (const z of zSlots) {
      const w = 0.8 + rnd() * 0.6; // X extent
      const h = 0.8 + rnd() * 1.0; // Y
      const d = 0.8 + rnd() * 0.6; // Z extent
      const x = xWall - sign * (w / 2 + 0.06);
      const rack = MeshBuilder.CreateBox(
        `dr_rack_${sign}_${z}`,
        { width: w, height: h, depth: d },
        scene,
      );
      // Front (inward-facing) face gets a vent grille via multi-mat-free trick:
      // a thin vent plate just inside the inward face.
      rack.material = rackMat;
      rack.position.set(x, floorTop + h / 2, z);
      tag(rack);

      const plate = MeshBuilder.CreatePlane(
        `dr_rackvent_${sign}_${z}`,
        { width: w * 0.7, height: h * 0.6 },
        scene,
      );
      plate.material = rackVentMat;
      plate.position.set(xWall - sign * (w + 0.07), floorTop + h / 2, z);
      plate.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      tag(plate);

      // A small greeble box on top.
      const cap = MeshBuilder.CreateBox(
        `dr_rackcap_${sign}_${z}`,
        { width: w * 0.5, height: 0.18, depth: d * 0.5 },
        scene,
      );
      cap.material = darkMat;
      cap.position.set(x, floorTop + h + 0.09, z);
      tag(cap);
    }
  };
  // Keep the camera-near (-X, -Z) corner clearer; bias -X racks toward +Z.
  placeRacks(ix, 1, [-6, -1, 5]);
  placeRacks(-ix, -1, [0, 4, 7]);

  // -- VENTS on walls -------------------------------------------------------
  const wallVent = (x: number, y: number, z: number, rotY: number): void => {
    const mat = new StandardMaterial(`dr_wv_${x}_${z}`, scene);
    mat.diffuseTexture = ventTex;
    mat.specularColor = new Color3(0.08, 0.08, 0.1);
    mat.backFaceCulling = false;
    const v = MeshBuilder.CreatePlane(`dr_wallvent_${x}_${z}`, { width: 1.1, height: 1.1 }, scene);
    v.material = mat;
    v.position.set(x, y, z);
    v.rotation.y = rotY;
    tag(v);
  };
  wallVent(ix - 0.03, 4.1, -3, -Math.PI / 2);
  wallVent(-ix + 0.03, 3.9, 2, Math.PI / 2);

  // -- VIEWPORT WINDOWS (framed starfield) ---------------------------------
  const viewport = (
    name: string,
    fw: number,
    fh: number,
    x: number,
    y: number,
    z: number,
    rotY: number,
    faceOffset: { x: number; z: number },
  ): void => {
    const frame = MeshBuilder.CreateBox(
      name + "_frame",
      { width: fw, height: fh, depth: 0.25 },
      scene,
    );
    frame.material = frameMat;
    frame.position.set(x, y, z);
    frame.rotation.y = rotY;
    tag(frame);

    const glass = MeshBuilder.CreatePlane(
      name + "_glass",
      { width: fw - 0.5, height: fh - 0.5 },
      scene,
    );
    glass.material = starMat;
    glass.position.set(x + faceOffset.x, y, z + faceOffset.z);
    glass.rotation.y = rotY;
    tag(glass);
  };
  // On the +X wall (very visible to the demo camera).
  viewport("dr_vpX", 3.4, 2.4, ix - 0.05, 3.6, -2, -Math.PI / 2, { x: -0.16, z: 0 });
  // On the far +Z wall, above the goal — dark space behind the green/gold goal.
  viewport("dr_vpZ", 4.0, 2.4, 0, 3.9, iz - 0.05, Math.PI, { x: 0, z: -0.16 });

  // -- HAZARD CHEVRON BAND near the goal end (desaturated grey) ------------
  {
    const mat = new StandardMaterial("dr_chevMat", scene);
    const tex = makeChevronTexture(scene, "dr_chevTex");
    tex.uScale = 10;
    tex.vScale = 1;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    mat.diffuseTexture = tex;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    const band = MeshBuilder.CreatePlane("dr_chevBand", { width: 11, height: 0.5 }, scene);
    band.material = mat;
    band.position.set(0, 0.62, iz - 0.04);
    band.rotation.y = Math.PI;
    tag(band);
  }

  // -- STENCILLED LABELS / DECALS ------------------------------------------
  // Orient each label so its readable face points into the room (same rotation
  // convention as the wall panel each one sits on, so the stencil text is not
  // mirrored).
  labelPlane("dr_lblModule", "MODULE 7", "SECT. A", 2.4, 1.2, ix - 0.04, 1.9, 4, -Math.PI / 2);
  labelPlane("dr_lblBay", "BAY 02", "", 1.8, 0.9, -ix + 0.04, 2.1, -4, Math.PI / 2);
  labelPlane("dr_lblExit", "EXIT", "AIRLOCK 7", 2.0, 1.0, -4.5, 4.4, iz - 0.04, Math.PI);

  return {
    dispose(): void {
      for (const m of meshes) {
        const mat = m.material;
        m.dispose();
        mat?.dispose();
      }
      meshes.length = 0;
    },
  };
}
