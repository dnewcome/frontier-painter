# Demo — The Frost Gap on a phone (touch playthrough)

The whole room solved on an emulated landscape iPhone (Chromium touch emulation,
3× DPR) using **only real touch input** — no `window.game` movement calls.

```bash
npm run playthrough:mobile   # -> demos/mobile/{demo.gif,demo.mp4,frames/}
```

It runs in real time on the rAF loop, so it's closed-loop: each beat polls game
state (joystick held until in reach, pulled until the rail's end, look-swipes
steered until the conduit is centered) instead of guessing timings.

| # | Beat | Touch input |
|---|------|-------------|
| 01 | `intro` | First-run card: premise + controls; symptom HUD visible behind it. |
| 02 | `phone-ui` | Tap **Start** → palette, objective HUD, joystick, BOOTS / GRAB. |
| 03 | `rejected` | Tap **CONDUCT**, tap the rail → "Rejected — wrong property", rail flares red. |
| 04 | `frost-rail` | Tap **COLD**, tap the rail → "Repaired: Access rail"; it freezes into a handhold. |
| 05 | `approach` | Hold the **left-thumb joystick** forward until within grab reach. |
| 06 | `grab` | Tap **GRAB** (button becomes RELEASE). |
| 07 | `pull-across` | Hold the joystick forward → pull hand-over-hand to the console end. |
| 08 | `aim-conduit` | **Right-thumb swipes** turn the view until the conduit is centered. |
| 09 | `console-online` | Tap **CONDUCT**, tap the conduit → console powers → win card (Next room / Replay). |

Exits non-zero unless the console latches (`goalReached`), so it's also the
end-to-end smoke test for the phone controls.
