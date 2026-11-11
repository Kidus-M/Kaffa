import type { IssueCode, PlotStatus } from "./types";

export type GapNeed = "boundary" | "location" | "photo" | "confirm";
export type GapSpec = { need: GapNeed; reason: string };

/** Issues only a person in the field can fix, and what to ask them for. Repairable issues open no gap. */
const FIELD_FIXES: Partial<Record<IssueCode, GapNeed>> = {
  polygon_required: "boundary",
  self_intersection: "boundary",
  degenerate_after_truncation: "boundary",
  too_few_vertices: "boundary",
  swapped_coordinates: "confirm",
  out_of_bounds: "location",
  missing_geometry: "location",
};

/** One request per plot: the most useful thing to ask the field agent for. */
export function gapsForPlot(input: { issueCodes: IssueCode[]; status: PlotStatus; overlaps: boolean }): GapSpec[] {
  const code = input.issueCodes.find((c) => FIELD_FIXES[c]);
  if (code) return [{ need: FIELD_FIXES[code]!, reason: code }];
  if (input.overlaps) return [{ need: "boundary", reason: "overlap" }];
  if (input.status === "review") return [{ need: "photo", reason: "review" }];
  return [];
}
