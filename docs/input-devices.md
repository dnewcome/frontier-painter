# Input devices for 3D drawing — research & plan

Goal: find a handheld input that makes **drawing strokes in 3D feel good**, ideally over **Bluetooth, with no VR headset required**, usable from the browser (this is a Babylon.js web game). This directly attacks the project's riskiest unknown: *does drawing in true 3D on a flat-ish setup actually feel good?*

## The core constraint

True 6DOF (position + orientation) in mid-air needs an **external spatial reference** — something must know where the device *is*, not just how it's tilted. That requirement is what forces a headset or base stations. Three approaches:

| Approach | How it gets position | Headset-free? | Examples |
|---|---|---|---|
| **Outside-in** | Headset/base-station cameras watch the device | ❌ needs that rig | Meta Quest Touch, Logitech MX Ink (Quest), Logitech VR Ink (Lighthouse) |
| **Inside-out (VSLAM)** | Camera *on the device* watches the room | ✅ | Xvisio 6DOF Stylus |
| **IMU-only** | Gyro + accelerometer | ✅ (orientation only; position drifts) | DualSense, Joy-Con, DIY ESP32 pen |
| **Optical + IMU** | A webcam tracks the device; IMU does orientation | ✅ | D-POINT, DodecaPen (DIY/research) |

**Takeaway:** "Bluetooth, no headset" practically means either an inside-out device (new, dev-focused) or an IMU device where we *design around* the no-absolute-position limitation. For drawing, the latter works great via **"aim a brush ray + set depth with a trigger."**

## Named products, against our bar

- **Logitech MX Ink** (~$130) — pairs over Bluetooth but is **tracked by the Quest headset's cameras**. No headset = no tracking. ❌ Not usable headset-free. <https://www.logitech.com/en-us/products/vr/mx-ink.html>
- **Logitech VR Ink Pilot Edition** (~$750, **discontinued**) — headset-free, but needs **SteamVR/Lighthouse base stations** mounted in the room. Trades the headset for a different external rig; EOL. <https://www.roadtovr.com/logitech-vr-stylus-pre-order-vr-ink-pilot-edition-price-release-date/>
- **Xvisio 6DOF Stylus** (announced **June 2026**) — closest to the literal ask: **inside-out VSLAM**, built for "naked-eye 3D displays / spatial design," **no headset, no base stations**. ⚠️ Reads as dev/enterprise (SDK-based); pricing/availability unclear; almost certainly not plug-and-play in a browser. Watch it; not the fast path. <https://www.businesswire.com/news/home/20260617562067/en/Xvisio-Technology-Unveils-Next-Generation-Spatial-Computing-devices-for-XR-and-Physical-AI-Data-collection>

## The realistic path for this game

**A — PS5 DualSense (fastest, ~$70).** Factory-calibrated gyro+accel. In-browser via WebHID (Chromium) using [`dualsense-ts`](https://github.com/nsfm/dualsense-ts), which outputs **fused quaternions** (Madgwick filter). Joy-Con / Switch Pro work too via the [JoyShockMapper](https://github.com/JibbSmart/JoyShockMapper) ecosystem. Live tester: [DualSense Explorer](https://nondebug.github.io/dualsense/dualsense-explorer.html).
- **Design trick:** don't chase hand *position*. Cast a **brush ray** from controller orientation; set depth with the trigger/stick ("aim and extrude"). This maps cleanly onto the existing `drawStroke(points[])` API — the controller just generates the points — and sidesteps IMU drift entirely.

**B — DIY ESP32 pen (the eventual "real" device; in the maker's wheelhouse).** ESP32-S3 + a fusion IMU (BNO085/BNO055 → clean quaternion out) → BLE → browser (Web Bluetooth GATT, no WebHID needed). Add an FSR tip for pressure + a button + optional haptics. References: [physical-cube-imu-web-bluetooth-esp32](https://github.com/alvarowolfx/physical-cube-imu-web-bluetooth-esp32), [Arduino-BLE-IMU](https://github.com/osteele/Arduino-BLE-IMU), [ESP32-BLE-CompositeHID](https://github.com/Mystfit/ESP32-BLE-CompositeHID). Gives MX-Ink-like stylus ergonomics with zero headset. (Related existing project: the IMU drumstick w/ voice-coil haptics — same recipe.)

**C — Optical + IMU for true position on a budget.** A regular webcam tracks the pen; the pen's IMU does orientation → headset-free 6DOF. DIY [D-POINT](https://hackaday.com/2023/11/14/d-point-a-digital-pen-with-optical-inertial-tracking/); research [DodecaPen](https://dl.acm.org/doi/10.1145/3126594.3126664). More work, real position.

## Linux reality (this dev machine)

- **Meta Quest / Oculus Touch controllers — NOT viable.** They are **not standalone Bluetooth HID gamepads**: they speak a proprietary radio to the *headset*, which bundles input + camera tracking and forwards it to the PC. Remove the headset and the controllers have no host and no tracking. The only "Touch as a gamepad" path (Virtual Desktop emulating an Xbox pad) still runs **through the headset**. Reverse-engineering the BLE link is possible in theory but there's no plug-and-play project, and you'd still get **no position** without the headset cameras. ([UploadVR](https://www.uploadvr.com/virtual-desktop-quest-update-touch-controllers/), [INAIRSPACE](https://inairspace.com/blogs/learn-with-inair/can-you-use-vr-controllers-without-the-headset-the-surprising-truth))
- **PS5 DualSense — trivially works on Linux.** Sony's official **`hid-playstation`** kernel driver supports it over **USB *and* Bluetooth**, exposing buttons/sticks/touchpad **and the gyro+accel as a separate `evdev` motion node**. Chromium's **WebHID works on Linux**, so `dualsense-ts` works in-browser. Pair it and go. ([Phoronix](https://www.phoronix.com/news/Sony-HID-PlayStation-PS5), [torvalds/linux hid-playstation.c](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-playstation.c))

## Recommendation / next step

1. Buy a **DualSense** (best Linux + browser support, cheapest, today). It answers the question that matters — *does 3D drawing feel good?* — before committing to a custom pen or chasing Xvisio.
2. Add a **gyro brush-ray input mode** to the game: read DualSense via WebHID, map orientation → a ray → `drawStroke` points, trigger sets depth/commits the stroke.
3. If the feel lands, build the **ESP32 pen (Option B)** for proper stylus ergonomics.

_Last updated: 2026-06-25._
