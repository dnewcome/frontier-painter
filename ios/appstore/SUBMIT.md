# Submitting Frontier Painter to App Review

Everything in App Store Connect that has an API is filled by
`asc_listing.py` from this folder (metadata, screenshots, age rating, price,
availability, review contact + notes, build). Three things are left, two of
them only a human can do.

## 1. Screen recording on a physical device (required for this account)

The account has no approved app yet, so App Review asks for a device
recording (Guideline 2.1 "Information Needed") — Tie Dyer was held for exactly
this. `metadata/review_notes.txt` item 1 already says one is attached, so
**attach it before submitting.**

Settings → Control Center → add *Screen Recording*. Open Control Center, tap
record, wait for the countdown, and go to the **Home Screen** so the recording
starts before the app launches. Hold the phone **landscape**. ~90–120 s, one take:

1. Tap the Frontier Painter icon. Title screen → tap **Start**.
2. **Room 1 (Wake-Up Bay):** follow the prompts — right stick (amber ring) to
   look at the three lights, left stick to fly to the two beacons. ✓ ticks show.
3. Fly through the lit exit door → room title card → **Room 2**. Fly to the
   rail, tap **GRAB**, push forward to pull along it. (Enough to show it; you
   don't have to finish every tutorial room.)
4. ☰ menu → show **Music** toggle and **Replay tutorial**, close the menu.
   *(To reach a puzzle quickly for the recording, you can finish the tutorial
   beforehand — the title screen then offers Continue.)*
5. **Room 5 (The Frost Gap):** pick **COLD** (top-left), walk up to the rail,
   tap **PAINT**, trace the spiral → "Repaired!". Grab the frosted rail and
   pull across. Pick **CONDUCTIVE**, PAINT the power conduit (trace the bolt)
   → ROOM CLEAR → walk through the door.
6. Stop recording.

No login, account, purchase, or user-generated content exists — nothing else
to show.

Get it to this machine: AirDrop to a Mac and copy it over, or Photos → Share
→ Tailscale → `i9-workstation`, then here:
`sudo tailscale file get --conflict=rename ~/Downloads`

Then:

```sh
ios/appstore/attach-recording.sh ~/Downloads/<recording>.mov 1.0.1
```

## 2. App Privacy (web UI only)

App Store Connect → Frontier Painter → **App Privacy** → Get Started →
"**No, we do not collect data from this app**" → Save → **Publish**.
(True: no accounts, analytics, ads or network use; progress is stored on the
device only; see `public/privacy.html`.)

## 3. Submit

Either App Store Connect → the 1.0.1 version → **Add for Review → Submit**,
or from here:

```sh
/usr/bin/python3 ~/.claude/skills/app-store-release/tools/asc_submit.py submit --app 6817117669
/usr/bin/python3 ~/.claude/skills/app-store-release/tools/asc_submit.py state  --app 6817117669
```

Release type is **Manual**: after approval nothing goes live until you press
*Release*.

## If Apple still asks (Guideline 2.1)

Reply in Resolution Center with the six answers at the top of
`metadata/review_notes.txt` and say the recording is attached to the review
notes, then **Resubmit** (same build).
