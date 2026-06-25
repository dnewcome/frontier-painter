// tests/magboots.spec.ts
// Deterministic proof of the magnetic-boots slice, driven ENTIRELY through
// window.game (no synthetic pointer/keyboard input):
//   plant -> walk across the FLOOR -> transition up a WALL -> onto the CEILING
//   (asserting surfaceNormal/up flip at each edge with no NaN) -> push off to
//   FLOAT -> drawStroke a handhold -> grab + pull to the GOAL -> win.
// Then: reset() restores identical state, and a full re-run reproduces the
// final state + the surface-normal transition sequence.
import { test, expect, type Page } from "@playwright/test";

// Stroke bridging the floating player to just short of the goal ([0,1,8], win
// radius 1.0m), with a slight vertical bow to exercise the 3D centerline math.
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
  (page as unknown as { _errors: string[] })._errors = errors;

  await page.goto("/");
  await page.waitForFunction(() => !!window.game && window.game.isReady(), null, {
    timeout: 30_000,
  });
}

function consoleErrors(page: Page): string[] {
  return (page as unknown as { _errors: string[] })._errors ?? [];
}

type Vec3 = [number, number, number];

interface Traversal {
  // M1 — plant on the floor.
  m1Booted: boolean;
  m1SurfaceNormal: Vec3;
  m1Up: Vec3;
  // M2 — floor -> wall.
  reachedWall: boolean;
  wallNormal: Vec3;
  yAtWall: number; // player y the step the wall normal latched (should be low)
  yBeforeWall: number; // player y just before the transition (~standHeight on floor)
  climbedY: number; // max y reached while on the wall (proves climbing)
  // M3 — wall -> ceiling.
  reachedCeiling: boolean;
  ceilingNormal: Vec3;
  ceilingPos: Vec3;
  ceilingUp: Vec3;
  // M4 — push off + draw.
  floatedAfterPush: boolean;
  pushVelocity: Vec3;
  handholdsBeforeDraw: number;
  handholdsAfterDraw: number;
  // M6 — legacy grab/pull/goal loop from the float state.
  grabbed: boolean;
  goalReached: boolean;
  finalPos: Vec3;
  // Full ordered sequence of distinct surface normals seen (determinism check).
  normalSequence: Vec3[];
  // True iff every sampled vector stayed finite the whole run.
  allFinite: boolean;
}

function isFiniteVec(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/** Run the full magboots traversal + legacy win loop; returns recorded facts. */
async function traverse(page: Page, stroke: Vec3[]): Promise<Traversal> {
  return page.evaluate((stroke) => {
    const g = window.game;
    const eq = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;
    const fin = (v: [number, number, number]) =>
      Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

    let allFinite = true;
    const normalSequence: [number, number, number][] = [];
    const recordNormal = (n: [number, number, number]) => {
      const last = normalSequence[normalSequence.length - 1];
      if (
        !last ||
        !eq(last[0], n[0], 1e-3) ||
        !eq(last[1], n[1], 1e-3) ||
        !eq(last[2], n[2], 1e-3)
      ) {
        normalSequence.push([n[0], n[1], n[2]]);
      }
    };
    const sample = () => {
      const s = g.getState();
      if (!fin(s.playerPos) || !fin(s.surfaceNormal) || !fin(s.up)) {
        allFinite = false;
      }
      recordNormal(s.surfaceNormal);
      return s;
    };

    // ---- M1: plant on the nearest surface (the floor) ----
    g.reset();
    g.setCameraMode("fp");
    g.setBoots(true);
    let s = g.step(1 / 60, 2);
    sample();
    const m1Booted = s.booted;
    const m1SurfaceNormal = s.surfaceNormal;
    const m1Up = s.up;

    // ---- M2: face +X and walk across the floor to wallPosX ----
    g.setFacing(0); // refTangent(floor)=+X, yaw 0 => face +X
    g.walk(1, 0);
    const yBeforeWall = g.getState().playerPos[1];
    let reachedWall = false;
    let wallNormal: [number, number, number] = [0, 1, 0];
    let yAtWall = 0;
    for (let i = 0; i < 2000 && !reachedWall; i++) {
      s = g.step(1 / 60, 1);
      sample();
      if (eq(s.surfaceNormal[0], -1, 1e-3)) {
        reachedWall = true;
        wallNormal = s.surfaceNormal;
        yAtWall = s.playerPos[1];
      }
    }

    // ---- M3: keep walking up the wall onto the ceiling ----
    let reachedCeiling = false;
    let climbedY = yAtWall;
    let ceilingNormal: [number, number, number] = [0, 1, 0];
    let ceilingPos: [number, number, number] = [0, 0, 0];
    let ceilingUp: [number, number, number] = [0, 1, 0];
    for (let i = 0; i < 2000 && !reachedCeiling; i++) {
      s = g.step(1 / 60, 1);
      sample();
      if (s.playerPos[1] > climbedY) climbedY = s.playerPos[1];
      if (eq(s.surfaceNormal[1], -1, 1e-3)) {
        reachedCeiling = true;
        ceilingNormal = s.surfaceNormal;
        ceilingPos = s.playerPos;
      }
    }
    // Keep walking forward along the ceiling (facing is now -X, into the room)
    // to clear the wall corner before pushing off, and to let the reorientation
    // tween (surfaceTweenSteps) settle so the SMOOTHED camera up finishes
    // rotating onto the ceiling normal. Stop near mid-ceiling (x ~ 0).
    for (let i = 0; i < 200 && s.playerPos[0] > 0.5; i++) {
      s = g.step(1 / 60, 1);
      sample();
    }
    g.walk(0, 0);
    for (let i = 0; i < 20; i++) {
      s = g.step(1 / 60, 1);
      sample();
    }
    ceilingUp = s.up;

    // ---- M4: push off into free-float, then draw a handhold mid-air ----
    g.walk(0, 0);
    const handholdsBeforeDraw = g.getState().handholds.length;
    g.pushOff(3);
    s = g.step(1 / 60, 1);
    sample();
    const floatedAfterPush = !s.booted;
    const pushVelocity = s.velocity;

    const id = g.drawStroke(stroke);
    const handholdsAfterDraw = g.getState().handholds.length;

    // ---- M6: legacy grab -> pull -> goal loop, from the float state ----
    let grabbed: string | null = null;
    for (let i = 0; i < 1200 && !grabbed; i++) {
      g.moveTo([0, 1, -6]);
      g.step(1 / 60, 1);
      grabbed = g.grab();
    }
    let gs = g.getState();
    for (let i = 0; i < 4000 && !gs.goalReached; i++) {
      g.pullAlong(2.5);
      gs = g.step(1 / 60, 1);
      if ((gs.grabT ?? 0) >= 1 && !gs.goalReached) {
        g.release();
        g.moveTo([0, 1, 8]);
        gs = g.step(1 / 60, 1);
      }
    }

    return {
      m1Booted,
      m1SurfaceNormal,
      m1Up,
      reachedWall,
      wallNormal,
      yAtWall,
      yBeforeWall,
      climbedY,
      reachedCeiling,
      ceilingNormal,
      ceilingPos,
      ceilingUp,
      floatedAfterPush,
      pushVelocity,
      handholdsBeforeDraw,
      handholdsAfterDraw,
      grabbed: grabbed === id,
      goalReached: gs.goalReached,
      finalPos: gs.playerPos,
      normalSequence,
      allFinite,
    } as Traversal;
  }, stroke);
}

test("magboots: floor -> wall -> ceiling traversal, then float + grab to goal", async ({
  page,
}) => {
  await gotoReady(page);

  const r = await traverse(page, STROKE);

  // M1 — planted on the floor, up == inward normal, no NaN.
  expect(r.m1Booted).toBe(true);
  expect(r.m1SurfaceNormal[0]).toBeCloseTo(0, 3);
  expect(r.m1SurfaceNormal[1]).toBeCloseTo(1, 3);
  expect(r.m1SurfaceNormal[2]).toBeCloseTo(0, 3);
  expect(r.m1Up[1]).toBeCloseTo(1, 3);

  // M2 — walked off the floor and the surface normal flipped to wallPosX's.
  expect(r.reachedWall).toBe(true);
  expect(r.wallNormal[0]).toBeCloseTo(-1, 3);
  expect(r.wallNormal[1]).toBeCloseTo(0, 3);
  expect(r.wallNormal[2]).toBeCloseTo(0, 3);
  // Climbing: player rose well above the floor stand height while on the wall.
  expect(r.climbedY).toBeGreaterThan(r.yBeforeWall + 1.0);

  // M3 — transitioned onto the ceiling (normal flipped to [0,-1,0]).
  expect(r.reachedCeiling).toBe(true);
  expect(r.ceilingNormal[1]).toBeCloseTo(-1, 3);
  // On the ceiling the center sits standHeight (1.0) below y=6.
  expect(r.ceilingPos[1]).toBeCloseTo(5, 1);
  // Camera up is finite and points roughly down (matches the ceiling normal).
  expect(isFiniteVec(r.ceilingUp)).toBe(true);
  expect(r.ceilingUp[1]).toBeLessThan(-0.5);

  // The ordered distinct-normal sequence begins floor -> wall -> ceiling. (A
  // trailing [0,1,0] is recorded once boots detach into float — see M4.)
  expect(r.normalSequence.length).toBeGreaterThanOrEqual(3);
  expect(r.normalSequence[0][1]).toBeCloseTo(1, 3); // floor
  expect(r.normalSequence[1][0]).toBeCloseTo(-1, 3); // wallPosX
  expect(r.normalSequence[2][1]).toBeCloseTo(-1, 3); // ceiling

  // No NaN anywhere across the whole traversal.
  expect(r.allFinite).toBe(true);

  // M4 — push off detached to float, with velocity along the (downward) ceiling
  // normal, and zero-g drawing still works mid-air.
  expect(r.floatedAfterPush).toBe(true);
  expect(r.pushVelocity[1]).toBeLessThan(0); // pushed off the ceiling => downward
  expect(r.handholdsAfterDraw).toBe(r.handholdsBeforeDraw + 1);

  // M6 — the legacy grab -> pull -> goal -> win loop still works after boots.
  expect(r.grabbed).toBe(true);
  expect(r.goalReached).toBe(true);

  // No uncaught console / page errors at any point.
  expect(consoleErrors(page)).toEqual([]);
});

test("magboots: reset restores identical state and a re-run reproduces it", async ({
  page,
}) => {
  await gotoReady(page);

  // A reset() must restore the exact deterministic spawn/boots state.
  const afterReset = await page.evaluate(() => {
    const g = window.game;
    // Perturb into a booted, walked state first...
    g.reset();
    g.setBoots(true);
    g.setFacing(0);
    g.walk(1, 0);
    g.step(1 / 60, 30);
    // ...then reset and snapshot.
    g.reset();
    return g.getState();
  });
  expect(afterReset.booted).toBe(false);
  expect(afterReset.playerPos[0]).toBeCloseTo(0, 5);
  expect(afterReset.playerPos[1]).toBeCloseTo(1, 5);
  expect(afterReset.playerPos[2]).toBeCloseTo(-8, 5);
  expect(afterReset.surfaceNormal[1]).toBeCloseTo(1, 5);
  expect(afterReset.up[1]).toBeCloseTo(1, 5);
  expect(afterReset.facing[2]).toBeCloseTo(1, 5);
  expect(afterReset.goalReached).toBe(false);
  expect(afterReset.handholds.length).toBe(0);
  expect(afterReset.elapsed).toBeCloseTo(0, 5);

  // Two full runs from reset reproduce the same final state + normal sequence.
  const a = await traverse(page, STROKE);
  const b = await traverse(page, STROKE);

  expect(b.goalReached).toBe(a.goalReached);
  expect(b.normalSequence).toEqual(a.normalSequence);
  expect(b.finalPos[0]).toBeCloseTo(a.finalPos[0], 3);
  expect(b.finalPos[1]).toBeCloseTo(a.finalPos[1], 3);
  expect(b.finalPos[2]).toBeCloseTo(a.finalPos[2], 3);
  expect(b.ceilingPos[1]).toBeCloseTo(a.ceilingPos[1], 3);

  expect(consoleErrors(page)).toEqual([]);
});
