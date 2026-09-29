// tests/door.spec.ts
// Room progression: the exit door stays sealed until the console is online,
// opens once it is, and moving through it loads the next room (with that
// room's wall stencils). Driven through window.game.
import { test, expect, type Page } from "@playwright/test";
import type { GameState, Vec3 } from "../src/types";

const RAIL_START: Vec3 = [0, 1.2, -6];

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  return errors;
}

const state = (page: Page): Promise<GameState> => page.evaluate(() => window.game.getState());

/** Float toward the doorway for up to `steps` fixed steps; returns the final state. */
const pushIntoDoorway = (page: Page, steps: number): Promise<GameState> =>
  page.evaluate((n) => {
    const g = window.game;
    let st = g.getState();
    for (let i = 0; i < n && !st.roomCleared; i++) {
      g.moveTo(st.exitAnchor);
      st = g.step(1 / 60, 1);
    }
    return st;
  }, steps);

test("exit door: sealed until the console is online, then leads to the next room", async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.game.loadScenario("frostgap"));

  const start = await state(page);
  expect(start.scenario).toBe("frostgap");
  expect(start.doorOpen).toBe(false);
  expect(start.roomCleared).toBe(false);

  // Sealed: flying right up to the doorway does nothing.
  const sealed = await pushIntoDoorway(page, 600);
  expect(sealed.playerPos[2]).toBeGreaterThan(9.0);
  expect(sealed.roomCleared).toBe(false);
  expect(sealed.doorProgress).toBe(0);

  // Solve the Frost Gap: frost the rail, cross it, power the conduit.
  const solved = await page.evaluate((railStart) => {
    const g = window.game;
    g.reset();
    g.selectColor("cold");
    g.paint("access-rail");
    for (let i = 0; i < 1200; i++) {
      g.moveTo(railStart);
      const p = g.step(1 / 60, 1).playerPos;
      if (Math.hypot(p[0] - railStart[0], p[1] - railStart[1], p[2] - railStart[2]) <= 0.85) break;
    }
    g.grab();
    for (let c = 0; c < 400 && (g.getState().grabT ?? 0) < 0.999; c++) {
      g.pullAlong(2.5);
      g.step(1 / 60, 1);
    }
    g.selectColor("conductive");
    g.paint("power-conduit");
    return g.step(1 / 60, 90); // 1.5 s: the door finishes retracting
  }, RAIL_START);
  expect(solved.goalReached).toBe(true);
  expect(solved.doorOpen).toBe(true);
  expect(solved.doorProgress).toBe(1);
  expect(solved.roomCleared).toBe(false); // standing at the console, not in the door

  // Go through it.
  await page.evaluate(() => window.game.release());
  const through = await pushIntoDoorway(page, 600);
  expect(through.roomCleared).toBe(true);

  // main.ts fades out and loads room 2 with a fresh, sealed door.
  await page.waitForFunction(() => window.game.getState().scenario === "crosswire", null, { timeout: 5_000, polling: 50 });
  const next = await state(page);
  expect(next.roomCleared).toBe(false);
  expect(next.doorOpen).toBe(false);
  expect(next.goalReached).toBe(false);
  await expect(page.locator("#room-fade .t")).toHaveText("THE CROSS-WIRED JUNCTION");
  expect(errors).toEqual([]);
});

test("the door opens the moment the room is clear, wherever you are", async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = window.game;
    g.loadScenario("frostgap");
    g.selectColor("cold");
    g.paint("access-rail");
    const half = g.step(1 / 60, 5);
    g.selectColor("conductive");
    g.paint("power-conduit");
    return { half, clear: g.step(1 / 60, 90) };
  });
  expect(r.half.doorOpen).toBe(false); // one surface still broken
  expect(r.clear.paintComplete).toBe(true);
  expect(r.clear.goalReached).toBe(false); // never went near the console
  expect(r.clear.doorOpen).toBe(true);
  expect(r.clear.doorProgress).toBe(1);
  await expect(page.locator("#exit-cue .flash.on")).toBeVisible();
});
