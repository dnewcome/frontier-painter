// tests/hop.spec.ts
// Boots-on jumping: a hop keeps the boots engaged. Magnetic gravity pulls the
// player toward the NEAREST surface, the view re-rights to it, and they land
// and plant there — floor -> ceiling, or onto an adjacent wall with a running
// jump. Driven through window.game (deterministic fixed steps).
import { test, expect, type Page } from "@playwright/test";
import type { GameState } from "../src/types";

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  await page.evaluate(() => window.game.loadScenario("none"));
}

const near = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test("hop off the floor lands on the ceiling, then back down", async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const g = window.game;
    g.setBoots(true);
    // Walk to the middle of the floor: spawn is 2 m from the back wall, which
    // would (correctly) become the nearest surface partway up the hop.
    g.walkTo([0, 1, 0]);
    let w = g.getState();
    for (let i = 0; i < 900 && Math.abs(w.playerPos[2]) > 0.25; i++) w = g.step(1 / 60, 1);
    g.walk(0, 0);
    const planted = g.step(1 / 60, 2);
    g.hop();
    let st: GameState = g.step(1 / 60, 1);
    const mid = st;
    let steps = 1;
    while (st.airborne && steps < 600) {
      st = g.step(1 / 60, 1);
      steps++;
    }
    const ceiling = g.step(1 / 60, 30); // let the camera tween finish
    g.hop();
    st = g.step(1 / 60, 1);
    for (let i = 0; i < 600 && st.airborne; i++) st = g.step(1 / 60, 1);
    const floor = g.step(1 / 60, 30);
    return { planted, mid, ceiling, floor, steps };
  });
  expect(r.planted.booted).toBe(true);
  expect(r.planted.surfaceNormal).toEqual([0, 1, 0]);
  // Mid-hop: still booted (magnetized), in the air.
  expect(r.mid.booted).toBe(true);
  expect(r.mid.airborne).toBe(true);
  // Landed + planted on the ceiling, camera re-righted to it.
  expect(r.ceiling.airborne).toBe(false);
  expect(r.ceiling.booted).toBe(true);
  expect(r.ceiling.surfaceNormal).toEqual([0, -1, 0]);
  expect(near(r.ceiling.up, [0, -1, 0], 1e-3)).toBe(true);
  expect(r.ceiling.playerPos[1]).toBeCloseTo(5, 5); // standHeight below the ceiling plane
  expect(r.steps).toBeLessThan(200);
  // And a hop off the ceiling brings you back to the floor.
  expect(r.floor.surfaceNormal).toEqual([0, 1, 0]);
  expect(r.floor.playerPos[1]).toBeCloseTo(1, 5);
});

test("hopping near the back wall lands you on the back wall", async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const g = window.game;
    g.setBoots(true); // planted at spawn, 2 m from the -Z wall
    g.step(1 / 60, 2);
    g.hop();
    let st: GameState = g.step(1 / 60, 1);
    for (let i = 0; i < 600 && st.airborne; i++) st = g.step(1 / 60, 1);
    return g.step(1 / 60, 30);
  });
  expect(r.airborne).toBe(false);
  expect(r.surfaceNormal).toEqual([0, 0, 1]); // wallNegZ
});

test("a running hop toward a wall lands on that wall", async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const g = window.game;
    g.setBoots(true);
    g.setFacing(0); // floor yaw 0 faces +X
    // Walk to ~2 m from the +X wall, keep running, and jump.
    let st: GameState = g.getState();
    for (let i = 0; i < 600 && st.playerPos[0] < 5.2; i++) {
      g.walk(1, 0);
      st = g.step(1 / 60, 1);
    }
    g.walk(1, 0);
    g.step(1 / 60, 1);
    g.hop(3.0);
    for (let i = 0; i < 600 && (i === 0 || st.airborne); i++) {
      st = g.step(1 / 60, 1);
    }
    g.walk(0, 0);
    return g.step(1 / 60, 30);
  });
  expect(r.booted).toBe(true);
  expect(r.airborne).toBe(false);
  expect(r.surfaceNormal).toEqual([-1, 0, 0]); // wallPosX
  expect(r.playerPos[0]).toBeCloseTo(7, 5);
});

test("boots on mid-air pull you to the nearest surface; boots off mid-hop floats", async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const g = window.game;
    // Float to the middle of the room (far from every surface), then boots on.
    let st: GameState = g.getState();
    for (let i = 0; i < 900; i++) {
      g.moveTo([0, 2.2, 0]);
      st = g.step(1 / 60, 1);
    }
    g.step(1 / 60, 120); // drift settles
    g.setBoots(true);
    const magnetized = g.getState();
    st = magnetized;
    for (let i = 0; i < 900 && st.airborne; i++) st = g.step(1 / 60, 1);
    const landed = g.step(1 / 60, 1);

    // Boots off mid-hop keeps the in-air velocity (free float, no gravity).
    g.hop();
    g.step(1 / 60, 10);
    g.setBoots(false);
    const released = g.getState();
    const later = g.step(1 / 60, 10);
    return { magnetized, landed, released, later };
  });
  expect(r.magnetized.booted).toBe(true);
  expect(r.magnetized.airborne).toBe(true);
  expect(r.landed.airborne).toBe(false);
  expect(r.landed.surfaceNormal).toEqual([0, 1, 0]); // y=2.2 is nearest the floor
  expect(r.released.booted).toBe(false);
  expect(r.released.velocity[1]).toBeGreaterThan(1); // still rising
  expect(r.later.playerPos[1]).toBeGreaterThan(r.released.playerPos[1]);
});
