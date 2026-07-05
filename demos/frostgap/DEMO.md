# Demo — The Frost Gap (property-paint slice)

The first playthrough of the **core verb**: you repair broken surfaces by painting
the one correct *physical property* onto them ("right property, right place").
Driven entirely through the deterministic `window.game` API — no synthetic input.

Regenerate with:

```bash
npm run playthrough:paint     # -> demos/frostgap/{demo.gif,demo.mp4,frames/}
```

## The room

Headed play (and this capture) arms the `frostgap` scenario: a sealed zero-g room
with two **broken** (un-rendered) surfaces gating the far console.

- **Access rail** — a dead rail arcing across the void. Needs `cold`.
- **Power conduit** — a dead panel by the console. Needs `conductive`.

The console latches (win) only when the player is in range **and every broken
surface is repaired**.

## Beats

| # | Beat | What happens |
|---|------|--------------|
| 01 | `arrive` | Both surfaces read **BROKEN** in the HUD; console locked; 0 handholds. |
| 02 | `wrong-color` | Paint the rail **conductive** — the wrong property. **Rejected**: it flares red, stays broken, no handhold. (The constraint, made visible.) |
| 03 | `frost-rail` | Paint the rail **cold** — correct. It frosts and **freezes into a grabbable handhold** across the void (handholds 0 → 1). |
| 04 | `approach` | Free-float to within grab range of the rail's start. |
| 05 | `grab` | Latch the frosted rail. |
| 06 | `locked-console` | Pull hand-over-hand to the console — but it's **dark**: `goalReached` is false while the conduit is dead. |
| 07 | `power-conduit` | Paint the conduit **conductive** — the door powers green, every surface repaired (`paintComplete`). |
| 08 | `win` | The console latches: `goalReached === true`, win banner shown. |
| 09 | `replay` | Re-run the whole paint→cross→power→win sequence twice; surface states + win + final position reproduce exactly (determinism). |

## What it proves

- The paint verb + palette (`cold` / `conductive` / `magnetic`) and the
  "one correct property per surface" constraint.
- Property effects that reshape play: `cold` → a grabbable handhold (reusing the
  grab/pull loop); `conductive` → the goal-gating power.
- The goal gate ANDs `paintField.complete()`, and the run is fully deterministic
  and headless (also a smoke test — exits non-zero unless the console powers on).
