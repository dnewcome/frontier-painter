// tests/mobile.spec.ts
// The phone experience, driven with REAL touch input on an emulated landscape
// iPhone (Chromium touch emulation, 3x DPR): tap-to-paint, the floating
// joystick, finger-look direction, boots, and the symptom-only objective HUD.
import { test, expect, type Page } from "@playwright/test";
import type { GameState } from "../src/types";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test.use({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
});

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, {
    timeout: 30_000,
  });
  // Dismiss the first-run how-to card.
  await page.getByRole("button", { name: "Start" }).tap();
  return errors;
}

const state = (page: Page): Promise<GameState> =>
  page.evaluate(() => window.game.getState());

/** Real touch drag via CDP (produces touch + pointer events, pointerType=touch). */
async function touchDrag(
  page: Page,
  from: [number, number],
  to: [number, number],
  holdMs = 0,
): Promise<void> {
  const c = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, id: 1 }];
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(...from) });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x, y) });
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await c.detach();
}

/** Screen point (CSS px) of a paint surface's on-surface anchor. */
async function surfacePoint(page: Page, id: string): Promise<[number, number]> {
  const p = await page.evaluate((sid) => {
    const s = window.game.getState().paintSurfaces.find((x) => x.id === sid);
    return s ? window.game.projectToScreen(s.anchor) : null;
  }, id);
  if (!p) throw new Error(`surface ${id} not on screen`);
  return p;
}

test("phone UI: touch layout + symptom-only objective HUD", async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator("#touch-ui")).toBeVisible();
  await expect(page.locator(".t-swatch")).toHaveCount(3);
  await expect(page.locator(".t-btn", { hasText: "BOOTS" })).toBeVisible();
  // The compact HUD diagnoses (symptom) instead of giving the answer away.
  const hud = page.locator("#hud .hud-objective");
  await expect(hud).toContainText("Overheated");
  await expect(hud).toContainText("Dead circuit");
  await expect(hud).not.toContainText("needs cold");
  // Desktop-only affordances stay hidden on touch.
  expect(await page.locator("#hud .hud-info").isVisible()).toBe(false);
  expect(errors).toEqual([]);
});

test("phone: tap a surface to paint it (wrong property rejected, right one repairs)", async ({ page }) => {
  const errors = await boot(page);

  // Wrong property first: conductive on the overheated rail -> rejected.
  await page.locator('.t-swatch[data-color="conductive"]').tap();
  expect((await state(page)).selectedColor).toBe("conductive");
  await page.touchscreen.tap(...(await surfacePoint(page, "access-rail")));
  await expect(page.locator(".t-toast")).toContainText("Rejected");
  let rail = (await state(page)).paintSurfaces.find((s) => s.id === "access-rail")!;
  expect(rail.satisfied).toBe(false);

  // Right property: cold -> repaired, and it froze into a grabbable handhold.
  await page.locator('.t-swatch[data-color="cold"]').tap();
  await page.touchscreen.tap(...(await surfacePoint(page, "access-rail")));
  await expect(page.locator(".t-toast")).toContainText("Repaired: Access rail");
  const s = await state(page);
  rail = s.paintSurfaces.find((x) => x.id === "access-rail")!;
  expect(rail.satisfied).toBe(true);
  expect(s.handholds.length).toBe(1);
  await expect(page.locator("#hud .hud-objective")).toContainText("repaired");
  expect(errors).toEqual([]);
});

test("phone: left-thumb joystick thrusts forward", async ({ page }) => {
  const errors = await boot(page);
  const z0 = (await state(page)).playerPos[2];
  // Push the stick UP (= forward, the spawn faces +Z) and hold it.
  await touchDrag(page, [140, 300], [140, 230], 1200);
  const z1 = (await state(page)).playerPos[2];
  expect(z1 - z0).toBeGreaterThan(0.4);
  expect(errors).toEqual([]);
});

test("phone: right-thumb drag looks (finger up -> look up)", async ({ page }) => {
  const errors = await boot(page);
  const y0 = (await state(page)).facing[1];
  await touchDrag(page, [660, 260], [660, 200]); // finger moves UP 60px
  const y1 = (await state(page)).facing[1];
  expect(y1).toBeGreaterThan(y0 + 0.1);
  await touchDrag(page, [660, 150], [660, 290]); // finger moves DOWN
  const y2 = (await state(page)).facing[1];
  expect(y2).toBeLessThan(y1 - 0.1);
  expect(errors).toEqual([]);
});

test("phone: BOOTS button plants you; action button becomes JUMP", async ({ page }) => {
  const errors = await boot(page);
  await page.locator('.t-btn[data-role="boots"]').tap();
  await expect.poll(async () => (await state(page)).booted).toBe(true);
  await expect(page.locator('.t-btn[data-role="action"]')).toHaveText("JUMP");
  await expect(page.locator('.t-btn[data-role="boots"]')).toHaveText("BOOTS ON");
  expect(errors).toEqual([]);
});
