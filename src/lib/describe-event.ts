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
    case "lot.plot_removed":
      return `${p.plotRef} removed from lot ${p.lotRef}: "${p.reason}".`;
    case "intake.batch_received":
      return `Register ${p.fileName} read: ${(p.created as string[]).length} plots created, ${p.review} rows to review.`;
    case "intake.row_accepted":
      return `Register row corrected and added as ${p.plotRef}.`;
    case "intake.row_rejected":
      return "A register row was rejected.";
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
    case "flag.raised":
      return `Lot ${p.lotRef} flagged: ${p.kind === "unmapped_supplier" ? "coffee from a supplier with no mapped plot" : p.kind === "volume_farmer" ? "a farmer delivered more than their plots can grow" : "more coffee than its plots can grow"} (${Number(p.deliveredKg).toLocaleString()} kg).`;
    case "flag.cleared":
      return `Flag on ${p.lotRef} cleared: "${p.reason}".`;
    case "flag.closed":
      return `Flag on ${p.lotRef} closed after the records changed.`;
    case "farmer.merged":
      return `Farmer records merged: ${p.merged} is ${p.keep}${refs ? ` (${refs})` : ""}.`;
    case "allocation.changed":
      return `Container plan changed: ${(p.changes as { lotRef: string }[]).map((c) => c.lotRef).join(", ")} moved.`;
    case "approval.requested":
      return `An agent asks for a decision: ${String(p.kind).replaceAll("_", " ")}.`;
    case "shipment.created":
      return `New shipment ${p.ref} for ${p.buyer}.`;
    case "email.received":
      return `Email read: "${p.subject}". ${p.outcome}`;
    case "email.sent":
      return "Approved reply sent to the buyer.";
    case "email.approved":
      return "Reply to a buyer approved.";
    case "question.received":
      return `Buyer question by ${p.channel}: ${p.status === "answered" ? "answered with citations" : p.status === "drafted" ? "answer drafted for approval" : "passed to you"}.`;
    case "visits.planned":
      return `Visits planned: ${p.plots} farms over ${p.days} day(s)${(p.skippedRain as string[])?.length ? `, avoiding rain on ${(p.skippedRain as string[]).join(", ")}` : ""}.`;
    case "visits.sent":
      return `Day plan for ${p.date} sent to a field agent.`;
    case "autonomy.changed":
      return `Autonomy changed: ${String(p.action).replaceAll("_", " ")} is now ${p.mode === "auto" ? "automatic" : p.mode === "ask" ? "ask first" : "off"}.`;
    default:
      return type.replaceAll(".", " ").replaceAll("_", " ");
  }
}
