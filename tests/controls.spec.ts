// tests/controls.spec.ts
// Desktop keyboard + mouse regression for the shared HumanControls layer:
// B plants the boots, W walks, mouse-up looks up, and a held W pulls you along
// a grabbed handhold. Real DOM input (no window.game movement calls).
import { test, expect, type Page } from "@playwright/test";
import type { GameState } from "../src/types";

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, {
    timeout: 30_000,
  });
  return errors;
}

const state = (page: Page): Promise<GameState> =>
  page.evaluate(() => window.game.getState());

test("desktop: B plants boots and W walks", async ({ page }) => {
  const errors = await boot(page);
  // No touch UI on desktop.
  expect(await page.locator("#touch-ui").count()).toBe(0);
  await page.locator("#renderCanvas").click({ position: { x: 640, y: 360 } });
  await page.keyboard.press("KeyB");
  await expect.poll(async () => (await state(page)).booted).toBe(true);
  const z0 = (await state(page)).playerPos[2];
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyW");
  expect((await state(page)).playerPos[2] - z0).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test("desktop: mouse up looks up (floating)", async ({ page }) => {
  const errors = await boot(page);
  const fire = (my: number) =>
    page.evaluate(
      (dy) =>
        window.dispatchEvent(
          new MouseEvent("mousemove", { movementX: 0, movementY: dy, buttons: 0 }),
        ),
      my,
    );
  const y0 = (await state(page)).facing[1];
  await fire(-80);
  const y1 = (await state(page)).facing[1];
  expect(y1).toBeGreaterThan(y0 + 0.05);
  await fire(160);
  expect((await state(page)).facing[1]).toBeLessThan(y1 - 0.05);
  expect(errors).toEqual([]);
});

test("desktop: holding W while grabbing pulls you along the handhold", async ({ page }) => {
  const errors = await boot(page);
  // Repair the rail so it freezes into a handhold, then float into grab range.
  await page.evaluate(() => {
    const g = window.game;
    g.selectColor("cold");
    g.paint("access-rail");
    for (let i = 0; i < 800; i++) {
      g.moveTo([0, 1.2, -6]);
      const p = g.step(1 / 60, 1).playerPos;
      if (Math.hypot(p[0], p[1] - 1.2, p[2] + 6) <= 0.8) break;
    }
    g.moveTo(g.getState().playerPos);
    g.step(1 / 60, 1);
  });
  await page.keyboard.press("KeyG"); // grab
  await expect.poll(async () => (await state(page)).grabbing).toBe(true);
  const t0 = (await state(page)).grabT ?? 0;
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyW");
  expect(((await state(page)).grabT ?? 0) - t0).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});

test("desktop: nudging the mouse after planting boots doesn't snap the view", async ({ page }) => {
  const errors = await boot(page);
  await page.keyboard.press("KeyB"); // plant facing the spawn heading (+Z)
  await expect.poll(async () => (await state(page)).booted).toBe(true);
  const before = (await state(page)).facing;
  expect(before[2]).toBeGreaterThan(0.99);
  // A small nudge must rotate a little from +Z — not jump to the surface's
  // reference tangent (+X), which the old stale accumulator did.
  await page.evaluate(() =>
    window.dispatchEvent(new MouseEvent("mousemove", { movementX: 12, movementY: 0, buttons: 0 })),
  );
  const after = (await state(page)).facing;
  expect(after[2]).toBeGreaterThan(0.95);
  expect(Math.abs(after[0])).toBeLessThan(0.2);
  expect(errors).toEqual([]);
});

test("desktop: room-skip (P) and camera (C) keys are debug-only", async ({ page }) => {
  const snap = () =>
    page.evaluate(() => {
      const s = window.game.getState();
      return [s.scenario, s.cameraMode];
    });
  await page.goto("/?room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  const before = await snap();
  await page.keyboard.press("KeyP");
  await page.keyboard.press("KeyC");
  expect(await snap()).toEqual(before);

  await page.goto("/?debug=1&room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  const [room0, cam0] = await snap();
  await page.keyboard.press("KeyP");
  await page.keyboard.press("KeyC");
  const [room1, cam1] = await snap();
  expect(room1).not.toBe(room0);
  expect(cam1).not.toBe(cam0);
});

test("desktop: F near a broken surface opens the trace; dragging the glyph paints it", async ({ page }) => {
  await page.goto("/?room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  await expect(page.locator("#paint-mark")).toContainText("[F]");
  await page.keyboard.press("Digit1"); // cold
  await page.keyboard.press("KeyF");
  await expect(page.locator("#paint-trace")).toBeVisible();
  const pts: [number, number][] = JSON.parse((await page.locator("#paint-trace").getAttribute("data-points")) ?? "[]");
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...p);
  await page.mouse.up();
  await expect(page.locator("#paint-trace .msg")).toContainText("Repaired");
  const s = await page.evaluate(() => window.game.getState());
  expect(s.paintSurfaces.find((x) => x.id === "access-rail")!.satisfied).toBe(true);
});

test("desktop: [ and ] adjust mouse sensitivity (remembered)", async ({ page }) => {
  await page.goto("/?room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  const turn = async () => {
    const f0 = (await page.evaluate(() => window.game.getState().facing));
    await page.evaluate(() =>
      window.dispatchEvent(new MouseEvent("mousemove", { movementX: 100, movementY: 0, buttons: 0 })),
    );
    const f1 = (await page.evaluate(() => window.game.getState().facing));
    return Math.abs(Math.atan2(f1[0], f1[2]) - Math.atan2(f0[0], f0[2]));
  };
  const base = await turn();
  expect(base).toBeCloseTo(0.12, 2); // 100 px x 0.0012 rad/px
  await page.keyboard.press("BracketRight");
  await page.keyboard.press("BracketRight");
  await expect(page.locator("#sens-tag")).toContainText("1.56");
  expect(await turn()).toBeCloseTo(base * 1.5625, 2);
  await page.reload();
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem("fp_mouse_sens"))).toBe("1.56");
  expect(await turn()).toBeCloseTo(0.12 * 1.56, 2);
});

test("web: FPS counter shows (and ?fps=0 hides it)", async ({ page }) => {
  await page.goto("/?room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  await expect(page.locator("#fps")).toContainText(/\d+ fps · \d+\.\d ms/, { timeout: 5_000 });
  await page.goto("/?room=frostgap&fps=0");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  await expect(page.locator("#fps")).toHaveCount(0);
});
