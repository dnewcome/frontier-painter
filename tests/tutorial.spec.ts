// tests/tutorial.spec.ts
// The four tutorial rooms: each is an ordered list of objective steps (look +
// float, grab + pull, mag boots, boots jump). Each room is completed here the
// way a player would — look, fly, grab, plant, walk, jump — through window.game,
// checking that every step advances and that the exit door opens at the end.
// Also: progress is saved and a fresh launch resumes the saved room.
import { test, expect, type Page } from "@playwright/test";
import type { GameState, Vec3 } from "../src/types";

async function open(page: Page, room: string): Promise<void> {
  await page.goto(`/?room=${room}`);
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
}

/** Run a script in the page with movement helpers (`g` = window.game, `h` =
 *  helpers); returns the objective step numbers seen and the final state. */
const play = (page: Page, script: string) =>
  page.evaluate((src) => {
    const g = window.game;
    const steps: number[] = [];
    const note = (s: GameState) => {
      const n = s.objective ? s.objective.step : 99;
      if (steps[steps.length - 1] !== n) steps.push(n);
      return s;
    };
    const h = {
      steps,
      fly(to: Vec3, within = 0.6, max = 1500) {
        let s = g.getState();
        for (let i = 0; i < max; i++) {
          if (Math.hypot(s.playerPos[0] - to[0], s.playerPos[1] - to[1], s.playerPos[2] - to[2]) < within) break;
          g.moveTo(to);
          s = note(g.step(1 / 60, 1));
        }
        return s;
      },
      walk(to: Vec3, until: (s: GameState) => boolean, max = 1500) {
        let s = g.getState();
        g.walkTo(to);
        for (let i = 0; i < max && !until(s); i++) s = note(g.step(1 / 60, 1));
        g.walk(0, 0);
        return s;
      },
      settle(n = 30) {
        let s = g.getState();
        for (let i = 0; i < n; i++) s = note(g.step(1 / 60, 1));
        return s;
      },
      look(at: Vec3) {
        const p = g.getState().playerPos;
        const d = [at[0] - p[0], at[1] - p[1], at[2] - p[2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        g.setFacing(Math.atan2(d[0], d[2]), Math.asin(d[1] / l));
        return note(g.step(1 / 60, 2));
      },
    };
    note(g.getState());
    // eslint-disable-next-line no-new-func
    new Function("g", "h", src)(g, h);
    return { steps, final: g.step(1 / 60, 60) };
  }, script);

test("room 1 (Wake-Up Bay): look at three lights, then fly to two beacons", async ({ page }) => {
  await open(page, "wakeup");
  const s0 = await page.evaluate(() => window.game.getState());
  expect(s0.objective?.step).toBe(1);
  expect(s0.objective?.total).toBe(5);
  expect(s0.objective?.beacon).not.toBeNull();
  expect(s0.doorOpen).toBe(false);
  const r = await play(
    page,
    `h.look([-7.4, 3, -3]); h.look([7.4, 2.4, -1]); h.look([0, 5.4, -4]);
     h.fly([0, 2.2, 0]); h.fly([0, 1.5, 7.2]);`,
  );
  expect(r.steps).toEqual([1, 2, 3, 4, 5, 99]);
  expect(r.final.roomClear).toBe(true);
  expect(r.final.doorOpen).toBe(true);
});

test("room 2 (Handhold Run): a ready-made rail — fly to it, grab, pull, let go", async ({ page }) => {
  await open(page, "handhold");
  const s0 = await page.evaluate(() => window.game.getState());
  expect(s0.handholds.length).toBe(1); // the rail is already there
  const r = await play(
    page,
    `h.fly([0, 1.2, -6], 0.5);
     g.grab(); h.settle(2);
     for (let i = 0; i < 600 && (g.getState().grabT ?? 0) < 0.99; i++) { g.pullAlong(2.5); h.settle(1); }
     g.release(); h.fly([0, 1.5, 8.4], 0.5);`,
  );
  expect(r.steps).toEqual([1, 2, 3, 4, 99]);
  expect(r.final.doorOpen).toBe(true);
  // The rail survives a reset (rebuilt with the room).
  const again = await page.evaluate(() => {
    window.game.reset();
    return window.game.getState();
  });
  expect(again.handholds.length).toBe(1);
  expect(again.objective?.step).toBe(1);
});

test("room 3 (Mag Boots): fly up, plant on the ceiling, walk across and down a wall", async ({ page }) => {
  await open(page, "boots");
  const r = await play(
    page,
    `h.fly([0, 5.3, -5], 0.3); h.settle(30);
     g.setBoots(true); h.settle(5);
     h.walk([3, 5, 2], (s) => Math.hypot(s.playerPos[0] - 3, s.playerPos[2] - 2) < 0.8);
     h.walk([8, 3.2, 2], (s) => s.surfaceNormal[0] < -0.9);
     // Auto-walk only steers within the current surface: aim past the bottom
     // edge to step onto the floor, then walk to the spot.
     h.walk([7, -2, 2], (s) => s.surfaceNormal[1] > 0.9);
     h.walk([5.5, 1, 2], (s) => s.surfaceNormal[1] > 0.9 && Math.abs(s.playerPos[0] - 5.5) < 0.8);`,
  );
  expect(r.steps).toEqual([1, 2, 3, 4, 5, 99]);
  expect(r.final.doorOpen).toBe(true);
});

test("room 4 (Boot Hop): boots on, jump, jump beside a wall onto it, walk up it", async ({ page }) => {
  await open(page, "hop");
  const r = await play(
    page,
    `g.setBoots(true); h.settle(5);
     g.hop(); h.settle(90);
     h.walk([7.1, 1, -2], (s) => Math.hypot(s.playerPos[0] - 7.1, s.playerPos[2] + 2) < 0.3);
     g.hop(); h.settle(120);
     h.walk([8, 4.4, -2], (s) => Math.abs(s.playerPos[1] - 4.4) < 0.5);`,
  );
  expect(r.steps).toEqual([1, 2, 3, 4, 99]);
  expect(r.final.doorOpen).toBe(true);
});

test("coach card shows the step and prompt; progress resumes on the next launch", async ({ page }) => {
  await open(page, "wakeup");
  await expect(page.locator(".hud-objective")).toContainText("STEP 1 / 5");
  await expect(page.locator(".hud-objective")).toContainText("look at the blinking light");
  // The first light starts off to your left: an edge arrow points at it.
  await expect(page.locator("#exit-cue .edge i")).toBeVisible();
  await expect(page.locator("#exit-cue")).toHaveClass(/goal/);

  // Finish room 1 and walk out: room 2 loads and is saved as progress.
  await play(
    page,
    `h.look([-7.4, 3, -3]); h.look([7.4, 2.4, -1]); h.look([0, 5.4, -4]);
     h.fly([0, 2.2, 0]); h.fly([0, 1.5, 7.2]); h.settle(90);
     let s = g.getState(); for (let i = 0; i < 600 && !s.roomCleared; i++) { g.moveTo(s.exitAnchor); s = g.step(1/60, 1); }`,
  );
  await page.waitForFunction(() => window.game.getState().scenario === "handhold", null, { timeout: 5_000, polling: 50 });
  expect(await page.evaluate(() => localStorage.getItem("fp_room"))).toBe("handhold");

  // A fresh launch (no ?room) resumes there.
  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.game.getState().scenario)).toBe("handhold");
});
