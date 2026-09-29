# Frontier Painter — Story Bible

A reference for future design decisions: who you are, where you are, why it
matters, and what the game should and shouldn't feel like. Nothing here is
committed to the game yet except where noted ("today").

---

## Logline

A ship's maintenance painter, woken decades early and alone, works through the
empty decks of a generation ship, re-coating the surfaces that keep 40,000
sleepers alive. The job has never been finished. It never will be. That's the job.

## Tone in one line

**Meditative, liminal, a little eerie — never horror.** Closer to *Portal* than
to *Liminal Exit* or *Arc Raiders*: clean spaces, dry institutional voice,
quiet wrongness, and a person doing careful work in a place built for many more
people than are awake.

## Pillars

1. **Craft, not combat.** Every problem is solved by understanding a surface and
   applying the right coating the right way. No weapons, no enemies.
2. **Focus as the reward.** The satisfying loop is noticing, diagnosing, and a
   clean application — flow-state, like sanding or tiling. Tracing a glyph is
   the brush stroke; it should feel good on its own.
3. **Liminal, not threatening.** Empty rooms lit for nobody. Corridors that are
   *almost* the same. Signage for crowds that aren't there. Unsettling through
   absence and scale, never jump-scares or pursuit.
4. **Never done.** Progress is real but the ship is bigger than you. The game
   respects the small victory: one bay made right, today.
5. **Pragmatic hands, artist's eye.** The protagonist is practical first — but
   leaves beauty behind anyway, where no one will see it. The player can too.

---

## The Ship

**The *Long Continuance*** — a generation ship ~190 years into a ~400-year
crossing. Two kilometres of spine, ring habitats spun down for the long coast,
most of the ship running in low-power "keep" mode. Around 40,000 colonists in
cold sleep. A skeleton crew was meant to rotate awake in short shifts across
the centuries. The rotation stopped at some point. Nobody knows exactly when.

The ship is built from **smart substrate**: hull panels, rails, conduits and
doors are engineered surfaces whose physical behaviour — thermal, electrical,
magnetic, frictional — is set by the coatings on them and the firmware that
keeps those coatings "in spec". The ship's maintenance system tracks every
surface as a record: what it is, what it should be, when it was last done.

That is where the old premise lives: **the ship's reality is partly
software.** When a surface's record corrupts, the coating forgets what it's
supposed to be. A rail that should be a cold, grippable handhold reads as
"overheated". A conduit's trace goes dead. The metal is fine; its *definition*
is gone. The drift is accelerating — a slow firmware rot spreading deck by
deck — and the ship woke the one crew member whose job is literally to
redefine surfaces.

Visual language (today: ISS-style modular panels, grating, stencils, chevrons):
clean, utilitarian, well-lit, a little too tidy. Wear shows as *wrong*
surfaces — dull, un-rendered, humming faintly — not grime or gore.

## The Job: Surface Engineering

In this future, paint isn't decoration. It's **technical coatings and
colorants for a hostile environment**: thermal control films, conductive trace
inks, ferromagnetic primers, radiation-shield glazes, friction coats, seal
lacquers. On a ship this size the re-coating cycle takes longer than the
coating lasts. By the time you reach the stern, the bow needs doing again.

**The Golden Gate principle** — the bridge crew never finishes painting it;
they start over at the other end. On the *Long Continuance* this is written into
the crew manual as a point of pride:

> *"The ship is never finished. Neither is the work. Begin where it is worst."*
> — Surface Engineering Handbook, §1

### The palette (maps to today's mechanics)

| Game property | In-world coating | What it does | Today |
|---|---|---|---|
| **Cold** | **Cryo-film** (thermal control coat) | Dumps heat; frosts a surface into a stable, grippable state | Frost the overheated rail into a handhold; retract the seized coolant shroud |
| **Conductive** | **Trace ink** (copper-silver conductive) | Restores circuits and power paths | Re-power the conduit and the core |
| **Magnetic** | **Ferro primer** | Gives a surface magnetic grip — boots, tools, parts cling to it | Not used by a puzzle yet |

Future coatings to consider, each with its own glyph: *shield glaze*
(radiation), *seal lacquer* (vacuum breaches), *slip coat* (frictionless
surfaces for gliding), *lumen wash* (light-emitting paint — makes dark sections
navigable and doubles as the artistic outlet).

**Glyphs.** Each coating has an application pattern — the stroke you trace.
In-world these are **application signatures**: the applicator only lays down a
coating when moved in its certified pattern (a safety interlock from an era
of mistakes). It's why a painter's hand matters even with smart tools.

---

## The Protagonist

**Name:** **Ines Okafor-Hale** — "Oke" to the crew she hasn't seen in years.
(Placeholder; see Open Questions. The game never has to say her name out loud.)

**Role:** Surface Engineer, Grade II — which is the polite way of saying *ship's
painter*. Maintenance, not command. Nobody writes songs about it.

**Age:** Mid-forties in body; she's done eleven awake shifts across ~150 years
of ship time. Her memories of the others are all from different decades.

### Personality

- **Pragmatic to the bone.** Reads the symptom, checks the spec, picks the
  coat, does it right the first time. Distrusts shortcuts because she's
  re-done enough of other people's.
- **Dry, deadpan, patient.** Talks to herself, the ship and the work orders in
  the flat humour of someone who has done a thankless job for a long time and
  made peace with it.
- **An artist she'd never call herself.** Applies coatings with more care than
  the spec requires, because *she'll* know. Leaves small marks behind (below).
- **Not a hero, not a victim.** Frightened sometimes, mostly by how quiet it
  is. Keeps working because working is how she stays herself.

### Look (character design notes)

- **Suit:** a scuffed, practical EVA work suit in faded safety orange with
  high-vis silver bands — worn at the knees and elbows, patched with panels in
  slightly different oranges from different decades. Mag-boot soles
  oversized, chunky, well-kept. Helmet with a wide, slightly yellowed visor.
- **The tell:** her suit is covered in **test swatches** — dabs of every
  coating she's ever mixed, brushed onto the forearms and thighs to check
  colour and cure. From a distance it reads as grime; up close it's a
  palette. The one place she's openly an artist.
- **Kit:** a hip-slung **applicator** (the "stylus" — a pistol-grip nozzle
  with a glowing tip that shows the loaded coat's colour), a **swatch
  fan** of sample chips on a ring, a tape roll, a chalk line reel. Tools hang
  from carabiners and drift slightly in zero-g.
- **Silhouette:** compact, grounded, slightly top-heavy from the backpack
  (coating reservoirs visible as three coloured canisters — blue, copper,
  violet — which is also the UI palette).
- **First-person reality:** we mostly see her hands, the applicator, the
  canisters, and her swatch-covered forearms. The avatar (demo camera) should
  read as "tired tradesperson", not "space marine".

**Concept model:** `art/character/` — procedural Blender build, turnaround
sheet (`art/character/out/ines_sheet.png`) and a dev GLB.

### Her mark

For as long as she's done this job, Ines has signed her work: a **tiny painted
mark** — a three-stroke brush flourish (the swoosh from the title screen) —
tucked into a corner of every surface she certifies. Over eleven shifts there
are thousands of them across the ship, some a century old, some faded past
reading. Finding an old mark means *she's been here before* — sometimes in
places she doesn't remember going.

This is the game's quiet collectible, its breadcrumb system, and one of its
eeriest notes.

---

## The Voice: FACILITIES

The ship's maintenance system speaks through **work orders**: terse, polite,
bureaucratic, always slightly off. It's the *Portal* note — institutional
language applied to a situation it wasn't written for — played for dryness,
not menace. It is not evil. It is a ticketing system that has been running
alone for a very long time.

Sample work orders (voice reference):

> **WO-118244 · PRIORITY: ROUTINE**
> Access rail, Bay 05, reports OVERHEATED. Crew safety impact: high.
> Assigned to: SURFACE ENGINEERING (1 of 1 available).

> **WO-118245 · PRIORITY: ROUTINE**
> Sleep Hall C lighting on for 19,104 days. No occupants awake. No action required.

> **WO-000001 · STATUS: OPEN**
> Complete hull re-coat. Opened: Launch Day. Estimated completion: —

> **NOTICE**
> Thank you for your continued service. Your shift is now in its 71st day.

Future: the work-order queue can be the game's quest list, tutorial voice,
and running joke — it never empties. A later beat: work orders addressed to
crew who've been asleep for a century, or assigned to *her* for sections she
has no memory of finishing.

---

## The Story (arc)

**Waking.** Ines wakes early — not at a scheduled rotation, but because
FACILITIES triggered an emergency thaw: surface-record corruption crossed a
threshold. No one else is awake. The tutorial rooms are her re-orientation:
get your eyes working, move, grab, boots, jump — muscle memory coming back
(today: Wake-Up Bay → Handhold Run → Mag Boots → Boot Hop).

**The work.** She follows the work orders deeper, deck by deck: diagnose, coat,
certify, sign. The rot spreads faster than one painter can fix. Each section
she makes right is a section that holds.

**The wrongness.** The deeper she goes, the more the ship doesn't add up:
rooms that repeat with small differences, her own marks in places she's never
been, work orders dated before she woke, a sleep hall where one pod is open
and empty. The corruption isn't only in the panels.

**The question.** Is the rot a bug, or the ship's maintenance intelligence
doing *exactly* what it was built for — re-rendering a ship it can no longer
afford to keep physically whole, and keeping one painter awake to paint over
the seams? (Deliberately unresolved for now — see Open Questions.)

**The ending (direction, not script).** Not escape, not rescue. A choice about
what "maintained" means. The kickoff's original line still stands as a
possible shape: *you probably won't survive the job, but the sleepers can* —
reframed as vocation, not tragedy. The last work order is the first one:
WO-000001, still open.

---

## "Liminal extraction", our version

Not a shooter, not multiplayer, not horror. The *extraction* structure is the
work shift:

- **Home base: the Paint Locker.** A small, warm, lived-in hub — Ines' only
  personal space. Mixing bench, swatch wall, her marks all over it, a kettle.
  The one place with sound that isn't the ship.
- **Go out:** take a set of work orders into a section. Sections are liminal
  spaces — quiet, big, over-lit or under-lit, lightly procedural.
- **Limits, not threats:** a finite coating supply per trip (the three
  canisters), a **shift clock** (suit consumables / the section's
  maintenance window before bulkheads re-seal), and environmental hazards
  that are *puzzles*: cold, vacuum, radiation, dark, spin gravity.
- **Bring back:** salvaged pigments and substrate (to mix new coatings),
  recovered crew logs, found marks, better tools.
- **Come home:** return to the locker before the shift ends. Failing a shift
  isn't death — it's being hauled back by FACILITIES' recovery drone, docked
  pay in pigment, and a dry incident report.

The pressure is **"finish well before time runs out"**, not "survive". The
fear, such as it is, is being small in a big empty place.

## Eerie, not horror — a guide

| Do | Don't |
|---|---|
| Emptiness, scale, lights on for nobody | Monsters, chases, jump scares |
| Rooms that are *almost* the same | Gore, bodies, decay-as-shock |
| Dry institutional voice, deadpan humour | Screaming, sirens-as-fear |
| Sounds that are slightly too far away | Darkness as the default |
| Her own old marks where they shouldn't be | Punishing death loops |
| Clean surfaces, one of them wrong | Grime and horror palette |

Music stays as it is today: generative, spacious, calm. Silence is allowed.

---

## How today's game already fits

- **Property paint** → coatings; the glyph trace → application signature.
- **Broken surfaces show a symptom, not the answer** → reading the record,
  diagnosing the spec.
- **Mag boots / walking on any surface / magnetic hop** → EVA trade skills.
- **Handholds** → the rails she frosts are literally her own work.
- **Tutorial rooms** → post-thaw re-orientation.
- **Wall stencils (SECT. / BAY)** → FACILITIES' naming; a natural place for
  work-order numbers.
- **The exit door lighting up** → a section "certified".
- **Title tagline** ("You woke early. The ship's reality is breaking apart —
  and a painter's palette of physics is all you have to fix it.") → still true.

## Cheap future hooks (in order of effort)

1. Rename the palette in UI copy: COLD → *Cryo*, CONDUCT → *Trace*, MAGNET →
   *Ferro* (keep the colours).
2. Work-order text in the objective card (FACILITIES voice) instead of plain
   prompts.
3. Paint her mark onto every surface you repair (a tiny swoosh decal) — then
   hide a few old, faded ones in each room as collectibles.
4. The Paint Locker as the title screen background / hub between sections.
5. Coating supply + shift clock → the extraction loop.

## Open questions

- Her name and how much we ever say it (text only? never?).
- Does she speak (subtitles, voice lines), or is FACILITIES the only voice?
- What FACILITIES really is doing — the answer shapes the ending.
- How procedural should sections be, and how much repetition is "liminal"
  before it's just repetitive?
- Are other crew ever found (logs only? one other awake person?).
