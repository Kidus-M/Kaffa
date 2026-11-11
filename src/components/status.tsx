import type { PlotStatus } from "@/domain/types";

export const STATUS_LABEL: Record<PlotStatus, string> = {
  clear: "Clear",
  review: "Needs review",
  blocked: "Blocked",
  not_checked: "Not checked",
};

export const STATUS_BG: Record<PlotStatus, string> = {
  clear: "bg-clear",
  review: "bg-review",
  blocked: "bg-blocked",
  not_checked: "bg-unchecked",
};

export const STATUS_TEXT: Record<PlotStatus, string> = {
  clear: "text-clear",
  review: "text-review",
  blocked: "text-blocked",
  not_checked: "text-unchecked",
};

const STATUS_WASH: Record<PlotStatus, string> = {
  clear: "bg-clear-wash",
  review: "bg-review-wash",
  blocked: "bg-blocked-wash",
  not_checked: "bg-unchecked-wash",
};

/** Status as a pill: colour and words together, never colour alone. */
export function StatusBadge({ status, accepted }: { status: PlotStatus; accepted?: boolean }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium ${STATUS_WASH[status]} ${STATUS_TEXT[status]}`}>
      <span className={`size-1.5 rounded-full ${STATUS_BG[status]}`} aria-hidden />
      {status === "review" && accepted ? "Accepted after review" : STATUS_LABEL[status]}
    </span>
  );
}

const REASON_TEXT: Record<string, string> = {
  awaiting_screening: "Waiting for satellite screening",
  invalid_geometry: "Boundary needs fixing before screening",
  loss_above_threshold: "Tree cover loss after 2020 above the blocking threshold",
  loss_below_threshold: "Some tree cover loss after 2020",
  recent_alerts: "Recent deforestation alerts",
  sources_disagree: "Satellite sources disagree",
  "missing_source:gfw_loss": "Tree cover loss data unavailable",
  "missing_source:gfw_alerts": "Alert data unavailable",
};

export const reasonText = (r: string) => REASON_TEXT[r] ?? r.replaceAll("_", " ");

const NEED_TEXT: Record<string, string> = {
  boundary: "Walk the boundary",
  location: "Send the location",
  photo: "Send a field photo",
  confirm: "Confirm the location on site",
};
export const needText = (n: string) => NEED_TEXT[n] ?? n;
