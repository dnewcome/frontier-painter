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
  { id: "frostgap", title: "The Frost Gap", sector: "SECT. A", short: "FROST GAP", bay: "BAY 01" },
  { id: "crosswire", title: "The Cross-Wired Junction", sector: "SECT. B", short: "JUNCTION", bay: "BAY 02" },
];

/** 1-based room number, or 0 for a scenario outside the sequence. */
export function levelNumber(id: ScenarioName): number {
  return LEVELS.findIndex((l) => l.id === id) + 1;
}

export function levelOf(id: ScenarioName): Level | null {
  return LEVELS.find((l) => l.id === id) ?? null;
}

/** The room after `id` (wraps to the first; "none" -> the first room). */
export function nextLevel(id: ScenarioName): Level {
  const i = LEVELS.findIndex((l) => l.id === id);
  return LEVELS[(i + 1) % LEVELS.length];
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
