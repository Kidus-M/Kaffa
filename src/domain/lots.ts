import type { PlotStatus } from "./types";

export type LotPlot = { id: string; status: PlotStatus; reviewAccepted?: boolean; openRequests?: number };

/**
 * A lot ships only when every plot behind it is clear, or is a review plot a person
 * accepted with a reason, and no plot has an open field request (an overlap claim,
 * for example). Blocked and unchecked plots always hold the lot.
 */
export function evaluateLot(plots: LotPlot[]): { state: "ready" | "held"; heldBy: string[] } {
  const heldBy = plots
    .filter((p) => (p.openRequests ?? 0) > 0 || !(p.status === "clear" || (p.status === "review" && p.reviewAccepted)))
    .map((p) => p.id);
  return { state: plots.length > 0 && heldBy.length === 0 ? "ready" : "held", heldBy };
}
