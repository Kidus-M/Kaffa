import type { PlotStatus } from "./types";

export type LotPlot = { id: string; status: PlotStatus; reviewAccepted?: boolean; openRequests?: number };

/**
 * A lot ships only when every plot behind it is clear, or is a review plot a person
 * accepted with a reason, no plot has an open field request (an overlap claim, for
 * example), and the supply chain auditor has no open flag on the lot. Blocked and
 * unchecked plots always hold the lot.
 */
export function evaluateLot(plots: LotPlot[], opts: { openFlags?: number } = {}): { state: "ready" | "held"; heldBy: string[] } {
  const heldBy = plots
    .filter((p) => (p.openRequests ?? 0) > 0 || !(p.status === "clear" || (p.status === "review" && p.reviewAccepted)))
    .map((p) => p.id);
  const ready = plots.length > 0 && heldBy.length === 0 && !(opts.openFlags ?? 0);
  return { state: ready ? "ready" : "held", heldBy };
}
