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
import { createTouchInput } from "./input/touchInput";
import { isTouchDevice } from "./input/device";
import { createTransition } from "./hud/transition";
import { createExitCue } from "./hud/exitCue";
import { createPaintTrace } from "./input/paintTrace";
import { LEVELS, asRoom, levelNumber, nextLevel } from "./levels";
import { createObjectives } from "./tutorial/objectives";
import { createAudio } from "./audio/audio";
import { showTitle } from "./hud/title";

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
  const dressing = createDressing(game.scene);
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
  const touch = isTouchDevice();
  // Phones get the compact objective HUD (symptoms, not answers) instead of the
  // desktop debug readout.
  const hud = createHud(hudRoot, { compact: touch });

  const objectives = createObjectives(game.scene, drawing.registry, touch);
  // Synthesized music + sfx (audio/audio.ts). Browsers need a user gesture
  // first: the title screen's button, or any first touch/key when it's skipped.
  const audio = createAudio();
  const unlockOnce = (): void => audio.unlock();
  window.addEventListener("pointerdown", unlockOnce, { once: true, capture: true });
  window.addEventListener("keydown", unlockOnce, { once: true, capture: true });
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyM" && !e.repeat) audio.setMusic(!audio.musicOn());
  });

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
    dressing,
    objectives,
  });

  // Where to start: ?room=<id> (dev / tests), else the saved progress, else
  // the first tutorial room. Progress is saved each time a room is entered.
  // (The deterministic boots capture calls loadScenario("none") itself.)
  const PROGRESS_KEY = "fp_room";
  const saveRoom = (id: string): void => {
    try {
      localStorage.setItem(PROGRESS_KEY, id);
    } catch {
      /* storage unavailable — progress just isn't kept */
    }
  };
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(PROGRESS_KEY);
  } catch {
    /* ignore */
  }
  const startRoom =
    asRoom(new URLSearchParams(window.location.search).get("room")) ?? asRoom(saved) ?? LEVELS[0].id;
  api.loadScenario(startRoom);

  // Title screen on every normal launch (a ?room= dev/test link skips it;
  // ?title=1 forces it).
  const q = new URLSearchParams(window.location.search);
  if (q.get("title") === "1" || !q.has("room")) {
    const idx = LEVELS.findIndex((l) => l.id === startRoom);
    showTitle({
      resumeLabel: idx > 0 ? `Room ${idx + 1} · ${LEVELS[idx].title}` : null,
      newGame: () => {
        api.loadScenario(LEVELS[0].id);
        saveRoom(LEVELS[0].id);
      },
      musicOn: () => audio.musicOn(),
      setMusic: (on) => audio.setMusic(on),
      onStart: () => audio.unlock(),
    });
  }

  // Sound cues from state changes (visual/audio only; never touches the sim).
  let prevAudio = { key: "", door: false, planted: false, air: false, grab: false, color: "", grabT: 0 };
  let stepClock = 0;
  let pullDist = 0;
  // A soft click for every button tap (title, menu, BOOTS, palette...).
  document.addEventListener(
    "pointerdown",
    (e) => {
      const b = (e.target as Element | null)?.closest?.("button");
      if (b && !b.classList.contains("t-swatch")) audio.play("click");
    },
    { capture: true },
  );
  game.scene.onBeforeRenderObservable.add(() => {
    const s = api.getState();
    const key = `${s.scenario}:${s.objective?.step ?? "done"}`;
    const planted = s.booted && !s.airborne;
    if (prevAudio.key && key !== prevAudio.key && prevAudio.key.split(":")[0] === s.scenario) {
      audio.play("tick");
    }
    if (s.doorOpen && !prevAudio.door && prevAudio.key.split(":")[0] === s.scenario) audio.play("door");
    if (planted && !prevAudio.planted) audio.play("boots");
    if (s.airborne && !prevAudio.air) audio.play("hop");
    if (s.grabbing && !prevAudio.grab) audio.play("grab");
    if (!s.grabbing && prevAudio.grab) audio.play("release");
    if (prevAudio.color && s.selectedColor !== prevAudio.color) audio.play(`select-${s.selectedColor}`);

    const dt = game.engine.getDeltaTime() / 1000;
    const intent = controls.moveIntent();
    // Thrusters: floating, not holding a rail, pushing the stick.
    audio.setThrust(!s.booted && !s.grabbing && !transition.busy() ? intent : 0);
    // Mag-boot footsteps while walking.
    if (planted && intent > 0.15) {
      stepClock += dt * (0.9 + intent * 1.6);
      if (stepClock > 0.5) {
        stepClock = 0;
        audio.play("step");
      }
    } else stepClock = 0.45; // first step lands promptly
    // Hand-over-hand taps while pulling along a rail.
    if (s.grabbing && s.grabT !== null) {
      pullDist += Math.abs(s.grabT - prevAudio.grabT);
      if (pullDist > 0.045) {
        pullDist = 0;
        audio.play("pull");
      }
    }
    prevAudio = {
      key,
      door: s.doorOpen,
      planted,
      air: s.airborne,
      grab: s.grabbing,
      color: s.selectedColor,
      grabT: s.grabT ?? 0,
    };
  });

  // Real human controls for headed play (keyboard thrust/walk + boots + grab +
  // camera + draw). Boots default OFF (player.reset() spawns floating), so the
  // existing draw->grab->pull->goal loop is untouched. These only perturb the
  // sim via per-fixed-step intent and one-shot verbs and never fire during the
  // scripted window.game playthrough, so determinism is preserved.
  const enterRoom = (id: (typeof LEVELS)[number]["id"]): void => {
    api.loadScenario(id);
    saveRoom(id);
  };
  const cycleScenario = (): void => enterRoom(nextLevel(paintField.scenario()).id);

  // Once a room is clear: ROOM CLEAR flash + EXIT marker / edge arrow.
  createExitCue({
    scene: game.scene,
    getState: () => api.getState(),
    project: (p) => api.projectToScreen(p),
  });

  // Walking out through the open exit door fades to the next room's title card
  // and loads it while the screen is black. (The empty "none" room has no next.)
  const transition = createTransition();
  game.scene.onBeforeRenderObservable.add(() => {
    if (transition.busy() || paintField.scenario() === "none") return;
    if (!api.getState().roomCleared) return;
    const next = nextLevel(paintField.scenario());
    audio.play("whoosh");
    transition.play(`ROOM ${levelNumber(next.id)} · ${next.sector}`, next.title.toUpperCase(), () =>
      enterRoom(next.id),
    );
  });

  // The paint gesture: PAINT near a broken surface opens a trace of the
  // selected property's glyph over it; completing the stroke applies the paint.
  const trace = createPaintTrace({
    keyHint: touch ? undefined : "F",
    sound: {
      start: () => audio.play("trace-start"),
      progress: (p) => audio.setTrace(p),
      reset: () => audio.play("trace-reset"),
    },
  });
  const surfaceOf = (id: string) => api.getState().paintSurfaces.find((s) => s.id === id);
  const requestPaint = (id: string): void => {
    const surf = surfaceOf(id);
    if (!surf || trace.isOpen()) return;
    trace.open(api.getState().selectedColor, surf.label, api.projectToScreen(surf.anchor), () => {
      const outcome = controls.paintSurface(id);
      audio.play(outcome === "repaired" ? "repaired" : "rejected");
      return outcome;
    });
  };

  const controls = createHumanInput({
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
    cycleScenario,
    requestPaint,
  });

  // PAINT marker over the broken surface in reach (hidden while tracing).
  game.scene.onBeforeRenderObservable.add(() => {
    const id = controls.paintTarget();
    const surf = id ? surfaceOf(id) : undefined;
    trace.setTarget(surf ? { label: surf.label, screen: api.projectToScreen(surf.anchor) } : null);
  });

  // Phones/tablets: on-screen twin-stick UI driving the same controls.
  if (touch) {
    createTouchInput({
      scene: game.scene,
      controls,
      getState: () => api.getState(),
      selectColor: (c) => api.selectColor(c),
      cycleScenario,
      reset: () => api.reset(),
      musicOn: () => audio.musicOn(),
      setMusic: (on: boolean) => audio.setMusic(on),
      replayTutorial: () =>
        transition.play(`ROOM 1 · ${LEVELS[0].sector}`, LEVELS[0].title.toUpperCase(), () =>
          enterRoom(LEVELS[0].id),
        ),
    });
  }

  game.start();
}

boot();
