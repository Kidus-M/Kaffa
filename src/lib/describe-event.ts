import { STATUS_LABEL } from "@/components/status";
import type { PlotStatus } from "@/domain/types";

type P = Record<string, unknown>;

/** Plain-language lines for ledger events, as the exporter reads them. */
export function describeEvent(type: string, payload: unknown): string {
  const p = (payload ?? {}) as P;
  const refs = (p.plotRefs as string[] | undefined)?.join(", ");
  switch (type) {
    case "demo.seeded":
      return `Demo data loaded: ${p.plots} synthetic plots, ${p.openRequests} field requests.`;
    case "plot.screened":
      return `${p.plotRef} screened: ${STATUS_LABEL[p.status as PlotStatus] ?? p.status}${p.simulated ? " (simulated satellite data)" : ""}.`;
    case "plot.recaptured":
      return `${p.plotRef} has a new ${p.source === "mini_app_walk" ? "walked boundary" : "location"} from the field${p.valid ? "" : ", still invalid"}.`;
    case "lot.held":
      return `Lot ${p.lotRef} held by ${(p.heldBy as string[]).join(", ") || "its plots"}.`;
    case "lot.ready":
      return `Lot ${p.lotRef} is ready to ship.`;
    case "chase.sent":
      return `Field agent asked about ${refs}.`;
    case "chase.reminded":
      return `Reminder sent about ${refs}.`;
    case "chase.escalated":
      return `No reply about ${refs}; escalated to you.`;
    case "field.replied":
      return `Field reply received${refs ? ` about ${refs}` : ""}.`;
    case "field_agent.registered":
      return "A field agent connected their Telegram account.";
    case "review.accepted":
      return `${p.plotRef} accepted after review: "${p.reason}".`;
    case "approval.approved":
      return `Approved: ${String(p.kind).replaceAll("_", " ")}.`;
    case "approval.rejected":
      return `Rejected: ${String(p.kind).replaceAll("_", " ")}.`;
    case "checks.requested":
      return `Checks started for ${p.plots} plots.`;
    case "daily.ran":
      return `Daily run finished: ${p.rescreened} plots re-screened, ${p.openRequests} requests open.`;
    default:
      return type.replaceAll(".", " ").replaceAll("_", " ");
  }
}
