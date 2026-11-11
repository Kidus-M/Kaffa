import type { PlotStatus } from "./types";

export type LotPlot = { id: string; status: PlotStatus; reviewAccepted?: boolean };

/**
 * A lot ships only when every plot behind it is clear, or is a review plot a person
 * accepted with a reason. Blocked and unchecked plots always hold the lot.
 */
export function evaluateLot(plots: LotPlot[]): { state: "ready" | "held"; heldBy: string[] } {
  const heldBy = plots
    .filter((p) => !(p.status === "clear" || (p.status === "review" && p.reviewAccepted)))
    .map((p) => p.id);
  return { state: plots.length > 0 && heldBy.length === 0 ? "ready" : "held", heldBy };
}
