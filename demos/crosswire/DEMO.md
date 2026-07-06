# Demo — The Cross-Wired Junction (interaction slice)

Room 2 of the property-paint game, where properties **chain**. The depth over
room 1 (The Frost Gap): the two surfaces aren't independent — repairing the first
*unlocks* the second. This turns "right property, right place" into "right
property, right place, right **order**". Driven entirely through the
deterministic `window.game` API — no synthetic input.

Regenerate with:

```bash
npm run playthrough:crosswire   # -> demos/crosswire/{demo.gif,demo.mp4,frames/}
```

## The puzzle

The console's **power core** is hidden behind a **coolant shroud**:

- **Coolant shroud** — needs `cold`. Frosting it makes it retract, **revealing**
  the core behind it.
- **Power core** — needs `conductive`, but it's `prerequisite: coolant-shroud`
  and hidden until the shroud is frosted. Painting it before then is rejected as
  *inaccessible* (not just the wrong color — the wrong order).

The console powers (and the goal latches) only when both are repaired and the
player is in range.

## Beats

| # | Beat | What happens |
|---|------|--------------|
| 01 | `arrive` | Only the **coolant shroud** is perceivable (needs `cold`, BROKEN). The core is hidden; console locked. |
| 02 | `approach-junction` | Float over to frame the junction wall. |
| 03 | `core-locked` | Try to power the core (`conductive`) **now** — rejected; it's inaccessible behind the shroud and not even visible yet. |
| 04 | `wrong-color` | Paint the shroud `conductive` — rejected (wrong property). |
| 05 | `frost-reveal` | Paint the shroud `cold` — it frosts, **retracts**, and the power core is **revealed** (now needs `conductive`, accessible). |
| 06 | `power-core` | Paint the revealed core `conductive` — the door powers green; the chain is complete. |
| 07 | `win` | Float to the console: `goalReached === true`, win banner. |
| 08 | `replay` | Re-run the whole chain twice; states + win + final position reproduce exactly. |

## What it proves

- **Prerequisite / reveal interaction:** a surface whose repair unlocks (and
  visually exposes) another. The core is absent from the HUD checklist until the
  shroud is frosted.
- **Order-sensitive rejection** distinct from wrong-color rejection (locked vs.
  wrong-property), so the puzzle is deduction of a *sequence*.
- Fully deterministic + headless (a smoke test — exits non-zero unless the chain
  is solved and the console powers on).
