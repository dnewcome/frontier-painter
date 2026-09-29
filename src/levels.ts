// src/levels.ts
// The playable room sequence + per-room presentation (wall stencils, titles).
// Walking out through a room's exit door loads nextRoom(); "none" is the empty
// legacy boots room and is not part of the sequence.
import type { ScenarioName } from "./paint/paintField";

export interface Level {
  id: Exclude<ScenarioName, "none">;
  /** Full room title, shown on the transition card + phone HUD. */
  title: string;
  /** Stencil sector code, e.g. "SECT. A". */
  sector: string;
  /** Short stencil name (fits the wall plate: ≤ 12 chars). */
  short: string;
  /** Bay plate on the -X wall. */
  bay: string;
}

export const LEVELS: readonly Level[] = [
  // Tutorial: one mechanic per room.
  { id: "wakeup", title: "Wake-Up Bay", sector: "SECT. A", short: "WAKE-UP BAY", bay: "BAY 01" },
  { id: "handhold", title: "Handhold Run", sector: "SECT. B", short: "HANDHOLDS", bay: "BAY 02" },
  { id: "boots", title: "Mag Boots", sector: "SECT. C", short: "MAG BOOTS", bay: "BAY 03" },
  { id: "hop", title: "Boot Hop", sector: "SECT. D", short: "BOOT HOP", bay: "BAY 04" },
  // Paint puzzles.
  { id: "frostgap", title: "The Frost Gap", sector: "SECT. E", short: "FROST GAP", bay: "BAY 05" },
  { id: "crosswire", title: "The Cross-Wired Junction", sector: "SECT. F", short: "JUNCTION", bay: "BAY 06" },
];

/** Number of tutorial rooms at the start of LEVELS. */
export const TUTORIAL_ROOMS = 4;

/** 1-based room number, or 0 for a scenario outside the sequence. */
export function levelNumber(id: ScenarioName): number {
  return LEVELS.findIndex((l) => l.id === id) + 1;
}

export function levelOf(id: ScenarioName): Level | null {
  return LEVELS.find((l) => l.id === id) ?? null;
}

/** The room after `id`. After the last room it loops to the first PUZZLE
 *  (the tutorial is not replayed); "none" -> the first room. */
export function nextLevel(id: ScenarioName): Level {
  const i = LEVELS.findIndex((l) => l.id === id);
  if (i === LEVELS.length - 1) return LEVELS[TUTORIAL_ROOMS];
  return LEVELS[i + 1];
}

/** A valid room id, or null. */
export function asRoom(id: string | null | undefined): Level["id"] | null {
  return LEVELS.find((l) => l.id === id)?.id ?? null;
}

/** Wall stencil text for a scenario. "none" keeps the original generic plates. */
export interface WallLabels {
  module: [string, string];
  bay: [string, string];
  exit: [string, string];
}

export function wallLabelsFor(id: ScenarioName): WallLabels {
  const lvl = levelOf(id);
  if (!lvl) {
    return { module: ["MODULE 7", "SECT. A"], bay: ["BAY 02", ""], exit: ["EXIT", "AIRLOCK 7"] };
  }
  return {
    module: [lvl.sector, lvl.short],
    bay: [lvl.bay, ""],
    exit: ["EXIT", `TO ${nextLevel(id).sector}`],
  };
}
