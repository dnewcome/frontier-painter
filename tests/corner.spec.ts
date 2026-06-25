// tests/corner.spec.ts
// Regression proof for the CORNER PUSH-OFF tunneling bug: when the player was
// planted right at a box corner the collision ellipsoid (r~0.4) overlapped a
// perpendicular wall, and pushOff's moveWithCollisions could eject the player
// OUT through it. The replant `inset` clamp keeps a planted rest pose at least
// (ellipsoid radius + margin) clear of every perpendicular wall, so the player
// can never stand close enough to a corner to overlap a wall -> pushOff cannot
// tunnel. Driven entirely through window.game (no synthetic input).
import { test, expect, type Page } from "@playwright/test";

const R = 0.4; // player ellipsoid radius (DEFAULT_CONFIG.playerEllipsoid)

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, {
    timeout: 30_000,
  });
}

// Walk into a corner, push off, and step; report the worst-case results.
async function cornerProbe(
  page: Page,
  target: [number, number, number],
): Promise<{
  restPos: [number, number, number];
  minWallGap: number; // smallest center-to-perpendicular-wall gap while planted
  afterPush: [number, number, number];
  insideThroughout: boolean;
}> {
  return page.evaluate(
    ({ target }) => {
      const g = window.game;
      const inside = (p: [number, number, number]) =>
        Math.abs(p[0]) < 8 &&
        p[1] > 0 &&
        p[1] < 6 &&
        Math.abs(p[2]) < 10;

      g.reset();
      g.setCameraMode("demo");
      g.setBoots(true);

      let insideThroughout = true;
      // Drive toward the corner; walkTo auto-steers + transitions surfaces.
      g.walkTo(target);
      let s = g.getState();
      for (let i = 0; i < 3000; i++) {
        s = g.step(1 / 60, 1);
        if (!inside(s.playerPos)) insideThroughout = false;
      }
      const restPos = s.playerPos as [number, number, number];

      // Smallest gap from the planted center to any wall it is NOT planted on.
      // The planted surface contributes the standHeight gap; the perpendicular
      // walls must stay >= ellipsoid radius away (no overlap).
      const gaps = [
        8 - Math.abs(restPos[0]),
        Math.min(restPos[1], 6 - restPos[1]),
        10 - Math.abs(restPos[2]),
      ];
      // Drop the smallest (that's the planted-surface standHeight ~1.0); the
      // remaining two are perpendicular-wall gaps.
      gaps.sort((a, b) => a - b);
      const minWallGap = gaps[1];

      // Push off the current surface and integrate; must stay inside the box.
      g.pushOff(3);
      for (let i = 0; i < 120; i++) {
        const st = g.step(1 / 60, 1);
        if (!inside(st.playerPos)) insideThroughout = false;
      }
      const afterPush = g.getState().playerPos as [number, number, number];

      return { restPos, minWallGap, afterPush, insideThroughout };
    },
    { target },
  );
}

// Every interior corner-ward target. Each drives the player toward a different
// box corner so all 8 corners / perpendicular-wall pairs are exercised.
const CORNERS: [number, number, number][] = [
  [7.9, 0.1, 9.9],
  [7.9, 0.1, -9.9],
  [-7.9, 0.1, 9.9],
  [-7.9, 0.1, -9.9],
  [7.9, 5.9, 9.9],
  [-7.9, 5.9, -9.9],
];

test("corner push-off never tunnels the player out of the box", async ({
  page,
}) => {
  await gotoReady(page);

  for (const target of CORNERS) {
    const r = await cornerProbe(page, target);

    // The planted rest pose keeps the ellipsoid clear of perpendicular walls.
    expect(r.minWallGap).toBeGreaterThanOrEqual(R);
    // The player never left the sealed box while planted or after pushing off.
    expect(r.insideThroughout).toBe(true);
    // Final post-push position is strictly inside the box.
    expect(Math.abs(r.afterPush[0])).toBeLessThan(8);
    expect(r.afterPush[1]).toBeGreaterThan(0);
    expect(r.afterPush[1]).toBeLessThan(6);
    expect(Math.abs(r.afterPush[2])).toBeLessThan(10);
  }
});
