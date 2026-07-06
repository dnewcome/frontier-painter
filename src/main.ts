// src/main.ts
// Boots the slice: a real Babylon scene on #renderCanvas (room, light, camera,
// distinct clear color) and wires window.game to the automation surface.
import { Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Collisions/collisionCoordinator";
// Side-effect: registers Ray.intersectsPlane / scene picking used by the drawing
// and paint aim-rays. Without it Babylon throws "Ray needs to be imported before
// as it contains a side-effect required by your code" on the first pointer-pick.
import "@babylonjs/core/Culling/ray";

import { DEFAULT_CONFIG } from "./types";
import { createGameEngine, createCameraRig } from "./core/engine";
import { createWorld } from "./world/room";
import { createDressing } from "./dressing/dressing";
import { createDrawing } from "./drawing/drawing";
import { createPaintField } from "./paint/paintField";
import { createPlayer } from "./player/player";
import { createAvatar } from "./player/avatar";
import { createHud } from "./hud/hud";
import { createAutomation } from "./automation/automation";
import { createHumanInput } from "./input/humanInput";

function boot(): void {
  const canvas = document.getElementById("renderCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("#renderCanvas not found");
  }
  const hudRoot = document.getElementById("hud");
  if (!(hudRoot instanceof HTMLElement)) {
    throw new Error("#hud not found");
  }

  const config = DEFAULT_CONFIG;

  const game = createGameEngine(canvas, config.fixedDt);
  // Distinct clear color so the preview is obviously rendering (not blank).
  game.scene.clearColor = new Color4(0.04, 0.06, 0.12, 1.0);

  // Verify the WebGL context actually came up.
  if (game.engine.isDisposed) {
    throw new Error("Babylon Engine failed to create a WebGL context");
  }

  const world = createWorld(game.scene, config);
  // Visual-only ISS-style set dressing (no collisions, deterministic layout).
  createDressing(game.scene);
  const drawing = createDrawing(game.scene, config);
  // Live pointer-draw starts OFF; the human-input wiring turns it on only in
  // first-person mode. The deterministic automation/test path runs in demo mode
  // and never relies on pointer input.
  drawing.setInputEnabled(false);

  // Property-paint targets (the core verb). Shares the drawing registry so a
  // repaired "cold" surface can freeze into a grabbable handhold.
  const paintField = createPaintField(game.scene, drawing.registry);

  const player = createPlayer(game.scene, drawing.registry, config);
  // Cosmetic third-person embodiment (the collision body itself is invisible).
  const avatar = createAvatar(game.scene);
  const camera = createCameraRig(game.scene, canvas);
  // First-person is the default PLAY camera (the headed human experience starts
  // in-cockpit). The deterministic automation/test/capture paths set their own
  // camera mode explicitly (they reset() + setCameraMode("demo")), so this only
  // affects the initial headed view and does not change scripted behavior.
  camera.setMode("fp");
  const hud = createHud(hudRoot);

  const api = createAutomation({
    engine: game,
    camera,
    player,
    world,
    registry: drawing.registry,
    paintField,
    hud,
    config,
    avatar,
  });

  // Headed play boots straight into the first paint puzzle. The deterministic
  // boots capture explicitly calls loadScenario("none") to run the empty room.
  api.loadScenario("frostgap");

  // Real human controls for headed play (keyboard thrust/walk + boots + grab +
  // camera + draw). Boots default OFF (player.reset() spawns floating), so the
  // existing draw->grab->pull->goal loop is untouched. These only perturb the
  // sim via per-fixed-step intent and one-shot verbs and never fire during the
  // scripted window.game playthrough, so determinism is preserved.
  createHumanInput({
    scene: game.scene,
    engine: game,
    player,
    drawing,
    paintField,
    camera,
    config,
    reset: () => api.reset(),
    selectColor: (c) => api.selectColor(c),
    paint: (id) => api.paint(id),
    cycleScenario: () => {
      const rooms = ["frostgap", "crosswire"] as const;
      const i = rooms.indexOf(paintField.scenario() as (typeof rooms)[number]);
      api.loadScenario(rooms[(i + 1) % rooms.length]);
    },
  });

  game.start();
}

boot();
