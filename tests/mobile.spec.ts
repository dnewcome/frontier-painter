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
  await page.goto("/?room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, {
    timeout: 30_000,
  });
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

/** Trace the open paint overlay's glyph with a real finger (CDP touch),
 *  following its guide points. `upTo` < 1 lifts the finger part-way. */
async function traceGlyph(page: Page, upTo = 1): Promise<void> {
  const pts: [number, number][] = JSON.parse(
    (await page.locator("#paint-trace").getAttribute("data-points")) ?? "[]",
  );
  expect(pts.length).toBeGreaterThan(10);
  const c = await page.context().newCDPSession(page);
  const tp = (x: number, y: number) => [{ x, y, id: 3 }];
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(...pts[0]) });
  const n = Math.max(2, Math.round((pts.length - 1) * upTo));
  for (let i = 1; i <= n; i++) {
    await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(...pts[i]) });
  }
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await c.detach();
}

test("phone: walk up, PAINT, trace the glyph (wrong property rejected, right one repairs)", async ({ page }) => {
  const errors = await boot(page);
  const action = page.locator('.t-btn[data-role="action"]');
  // Spawn is ~2 m from the dead rail: in reach, so the action button is PAINT
  // and a PAINT marker names the surface.
  await expect(action).toHaveText("PAINT");
  await expect(page.locator("#paint-mark")).toContainText("Access rail");

  // Wrong property first: conductive on the overheated rail -> rejected.
  await page.locator('.t-swatch[data-color="conductive"]').tap();
  await action.tap();
  await expect(page.locator("#paint-trace")).toBeVisible();
  await expect(page.locator("#paint-trace .head")).toContainText("CONDUCTIVE");
  await traceGlyph(page);
  await expect(page.locator("#paint-trace .msg")).toContainText("Rejected");
  await expect(page.locator("#paint-trace")).toBeHidden();
  expect((await state(page)).paintSurfaces.find((s) => s.id === "access-rail")!.satisfied).toBe(false);

  // Lifting the finger half-way does nothing (stroke resets, no paint).
  await page.locator('.t-swatch[data-color="cold"]').tap();
  await action.tap();
  await traceGlyph(page, 0.5);
  await expect(page.locator("#paint-trace .msg")).toContainText("Keep your finger down");
  expect((await state(page)).paintSurfaces.find((s) => s.id === "access-rail")!.satisfied).toBe(false);

  // Full cold trace -> repaired, and it froze into a grabbable handhold.
  await traceGlyph(page);
  await expect(page.locator("#paint-trace .msg")).toContainText("Repaired");
  const s = await state(page);
  expect(s.paintSurfaces.find((x) => x.id === "access-rail")!.satisfied).toBe(true);
  expect(s.handholds.length).toBe(1);
  await expect(page.locator("#hud .hud-objective")).toContainText("repaired");
  await expect(page.locator("#paint-trace")).toBeHidden();
  // Nothing else is in reach from spawn (the conduit is across the room).
  await expect(action).not.toHaveText("PAINT");
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
  // Repair the rail (in reach of spawn) so PAINT doesn't take the button.
  await page.evaluate(() => {
    window.game.selectColor("cold");
    window.game.paint("access-rail");
  });
  await page.locator('.t-btn[data-role="boots"]').tap();
  await expect.poll(async () => (await state(page)).booted).toBe(true);
  await expect(page.locator('.t-btn[data-role="action"]')).toHaveText("JUMP");
  await expect(page.locator('.t-btn[data-role="boots"]')).toHaveText("BOOTS ON");
  expect(errors).toEqual([]);
});

test("phone: menu has no room-skip / camera items unless ?debug=1", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Menu" }).tap();
  await expect(page.getByRole("button", { name: /Restart room/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Next room/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Camera/ })).toHaveCount(0);

  await page.goto("/?debug=1&room=frostgap");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  await page.getByRole("button", { name: "Menu" }).tap();
  await expect(page.getByRole("button", { name: /Next room/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Camera/ })).toHaveCount(1);
});

test("phone: holding the right look stick at its edge keeps turning; releasing stops", async ({ page }) => {
  const errors = await boot(page);
  const yaw = async () => {
    const f = (await state(page)).facing;
    return Math.atan2(f[0], f[2]);
  };
  const c = await page.context().newCDPSession(page);
  const tp = (x: number, y: number) => [{ x, y, id: 5 }];
  // Press on the right side and push the knob out to the right edge (80 px >
  // the 56 px ring), then hold still.
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(620, 200) });
  for (let i = 1; i <= 8; i++) {
    await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(620 + i * 10, 200) });
  }
  await expect(page.locator(".t-stick-base.look")).not.toHaveClass(/idle/);
  const y0 = await yaw();
  await page.waitForTimeout(700);
  const y1 = await yaw();
  // Finger didn't move, but the view kept turning right (yaw grows toward +X).
  expect(y1 - y0).toBeGreaterThan(0.3);
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await c.detach();
  const y2 = await yaw();
  await page.waitForTimeout(400);
  expect(Math.abs((await yaw()) - y2)).toBeLessThan(1e-6); // stopped
  await expect(page.locator(".t-stick-base.look")).toHaveClass(/idle/);
  expect(errors).toEqual([]);
});

test("phone: stuck-stick guards — left touches always drive the stick, look only from its ring, focus loss releases", async ({ page }) => {
  const errors = await boot(page);
  const c = await page.context().newCDPSession(page);
  const T = (type: string, pts: [number, number, number][]) =>
    c.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const stickIdle = () =>
    page.evaluate(() => document.querySelector(".t-stick-base:not(.look)")!.classList.contains("idle"));
  const yaw = async () => {
    const f = (await state(page)).facing;
    return Math.atan2(f[0], f[2]);
  };

  // 1. Hold the stick, then the app loses focus (backgrounded) with no
  //    touch-end ever arriving: the stick lets go.
  await T("touchStart", [[150, 300, 1]]);
  await T("touchMove", [[150, 240, 1]]);
  expect(await stickIdle()).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect(await stickIdle()).toBe(true);

  // 2. A new left touch takes the stick (never becomes a look drag), even while
  //    the old finger is (as far as the page knows) still down.
  const y0 = await yaw();
  await T("touchStart", [[150, 240, 1], [200, 300, 2]]);
  await T("touchMove", [[150, 240, 1], [260, 300, 2]]); // drag right on the left side
  expect(await stickIdle()).toBe(false);
  expect(Math.abs((await yaw()) - y0)).toBeLessThan(1e-6); // no look from the left
  await T("touchEnd", []);
  expect(await stickIdle()).toBe(true);

  // 3. Dragging on the right but away from the look ring does nothing.
  const y1 = await yaw();
  await T("touchStart", [[470, 80, 3]]);
  for (let i = 1; i <= 6; i++) await T("touchMove", [[470 + i * 15, 80, 3]]);
  await T("touchEnd", []);
  expect(Math.abs((await yaw()) - y1)).toBeLessThan(1e-6);
  await c.detach();
  expect(errors).toEqual([]);
});

test("title screen: shown on launch, Start dismisses it; with progress it offers Continue + New game", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  await expect(page.locator("#title .mark")).toContainText("FRONTIER");
  await expect(page.locator("#title button.go")).toHaveText("Start"); // fresh: no progress
  await expect(page.locator("#title button.music")).toContainText("Music: On");
  await page.locator("#title button.music").tap();
  await expect(page.locator("#title button.music")).toContainText("Music: Off");
  await page.locator("#title button.go").tap();
  await expect(page.locator("#title")).toHaveCount(0);
  expect(await page.evaluate(() => window.game.getState().scenario)).toBe("wakeup");
  // The menu remembers the music setting.
  await page.getByRole("button", { name: "Menu" }).tap();
  await expect(page.getByRole("button", { name: /Music: off/ })).toBeVisible();

  // With saved progress: Continue names the room; New game restarts the tutorial.
  await page.evaluate(() => localStorage.setItem("fp_room", "boots"));
  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
  await expect(page.locator("#title button.go")).toContainText("Continue");
  await expect(page.locator("#title button.go")).toContainText("Room 3 · Mag Boots");
  expect(await page.evaluate(() => window.game.getState().scenario)).toBe("boots");
  await page.locator("#title button.new").tap();
  await expect(page.locator("#title")).toHaveCount(0);
  expect(await page.evaluate(() => window.game.getState().scenario)).toBe("wakeup");
  expect(await page.evaluate(() => localStorage.getItem("fp_room"))).toBe("wakeup");
  expect(errors).toEqual([]);
});
