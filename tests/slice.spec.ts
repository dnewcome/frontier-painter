// tests/slice.spec.ts
// End-to-end proof of Vertical Slice 1, driven entirely through window.game
// (no synthetic pointer/keyboard input). Mirrors playthrough beats B1..B9:
// ready -> reset -> demo camera -> draw a handhold -> approach -> grab ->
// pull along the tube -> reach the goal -> replay determinism.
import { test, expect, type Page } from "@playwright/test";
import type { GameState } from "../src/types";

// The intended bridge: from just ahead of spawn to just short of the goal
// (goal center is [0,1,8], win radius 1.0m), with a slight vertical bow to
// prove the centerline math handles a real 3D path.
const STROKE: [number, number, number][] = [
  [0, 1, -6],
  [0, 1.4, 0],
  [0, 1, 7.4],
];

async function gotoReady(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  // Stash collected errors on the page for later assertions.
  (page as unknown as { _errors: string[] })._errors = errors;

  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, {
    timeout: 30_000,
  });
  // This is the locomotion slice: run in the empty room (headed play defaults to
  // the frostgap paint scenario, which would gate the goal on repaired surfaces).
  await page.evaluate(() => window.game.loadScenario("none"));
}

function consoleErrors(page: Page): string[] {
  return (page as unknown as { _errors: string[] })._errors ?? [];
}

/** Run the full draw->grab->pull->win sequence; returns the final state. */
async function playthrough(page: Page): Promise<GameState> {
  return page.evaluate((stroke) => {
    const g = window.game;
    g.reset();
    g.setCameraMode("demo");

    const id = g.drawStroke(stroke);
    if (!id) throw new Error("drawStroke returned no id");

    // Approach the tube start until grab() latches (B5/B6).
    let grabbed: string | null = null;
    for (let i = 0; i < 600 && !grabbed; i++) {
      g.moveTo([0, 1, -6]);
      g.step(1 / 60, 1);
      grabbed = g.grab();
    }
    if (grabbed !== id) {
      throw new Error(`grab failed: got ${grabbed}, expected ${id}`);
    }

    // Pull hand-over-hand toward the goal end (B7), latching the win (B8).
    let st = g.getState();
    for (let i = 0; i < 2000 && !st.goalReached; i++) {
      g.pullAlong(2.5);
      st = g.step(1 / 60, 1);
      if ((st.grabT ?? 0) >= 1 && !st.goalReached) {
        // Reached the tube end but not yet inside the goal: let go and drift in.
        g.release();
        g.moveTo([0, 1, 8]);
        st = g.step(1 / 60, 1);
      }
    }
    return st;
  }, STROKE);
}

test("slice 1: draw a handhold and pull to the goal", async ({ page }) => {
  await gotoReady(page);

  // B1: ready
  const ready = await page.evaluate(() => window.game.getState().ready);
  expect(ready).toBe(true);

  // B2: reset returns a clean deterministic state
  const afterReset = await page.evaluate(() => {
    window.game.reset();
    return window.game.getState();
  });
  expect(afterReset.playerPos[1]).toBeCloseTo(1, 5);
  expect(afterReset.playerPos[2]).toBeCloseTo(-8, 5);
  expect(afterReset.grabbing).toBe(false);
  expect(afterReset.handholds.length).toBe(0);
  expect(afterReset.goalReached).toBe(false);
  expect(afterReset.elapsed).toBeCloseTo(0, 5);

  // B3: demo camera
  const mode = await page.evaluate(() => {
    window.game.setCameraMode("demo");
    return window.game.getState().cameraMode;
  });
  expect(mode).toBe("demo");

  // B4..B8: full playthrough
  const finalState = await playthrough(page);
  expect(finalState.handholds.length).toBe(1);
  expect(finalState.goalReached).toBe(true);

  // B9: replay determinism — identical inputs -> matching outcome.
  const replay = await playthrough(page);
  expect(replay.goalReached).toBe(true);
  expect(replay.playerPos[2]).toBeCloseTo(finalState.playerPos[2], 3);
  expect(replay.elapsed).toBeCloseTo(finalState.elapsed, 3);

  // No uncaught console / page errors at any point.
  expect(consoleErrors(page)).toEqual([]);
});
