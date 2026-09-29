// tests/containment.spec.ts
// Holding thrust against a wall (as a held joystick does) must never leak the
// player out of the room box. Regression for an escape through the far wall
// seen on iPad: the collider occasionally let a step sink into the wall, and
// with velocity pinned into it the slips accumulated until the player popped out.
import { test, expect } from "@playwright/test";

test("holding thrust into a wall never pushes the player out of the room", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  // Thrust like a held joystick (velocity stays pinned at maxSpeed into the
  // wall) for 20 s of sim time, toward every wall, floor/ceiling, and corner.
  const worst = await page.evaluate(() => {
    const g = window.game;
    const dirs: [number, number, number][] = [
      [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
      [0, -0.3, 1], [0.7, -0.4, 0.6], [-0.6, 0.5, 0.6],
    ];
    const out: number[] = [];
    for (const d of dirs) {
      g.loadScenario("frostgap");
      let m = 0;
      for (let i = 0; i < 1200; i++) {
        g.applyImpulse([d[0] * 0.12, d[1] * 0.12, d[2] * 0.12]);
        const p = g.step(1 / 60, 1).playerPos;
        m = Math.max(m, Math.abs(p[0]) - 7.35, Math.abs(p[2]) - 9.35, 0.65 - p[1], p[1] - 5.35);
      }
      out.push(m);
    }
    return Math.max(...out);
  });
  // Center never gets further than the ellipsoid radius into any wall.
  expect(worst).toBeLessThanOrEqual(1e-6);
});
