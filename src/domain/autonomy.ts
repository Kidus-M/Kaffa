/**
 * Autonomy settings: for each kind of action, whether an agent acts alone, asks a
 * person first, or does nothing. Actions with legal weight are locked to "ask".
 */
export type AutonomyMode = "auto" | "ask" | "off";

export type AutonomyAction = {
  id: string;
  label: string;
  agent: string;
  defaultMode: AutonomyMode;
  /** Locked actions always ask a person, whatever is stored. */
  locked: boolean;
  note?: string;
};

export const AUTONOMY_ACTIONS = [
  { id: "chase_field_agent", label: "Chase or remind a registered field agent", agent: "Field liaison", defaultMode: "auto", locked: false },
  { id: "send_day_plan", label: "Send a day plan to a field agent", agent: "Field planner", defaultMode: "auto", locked: false },
  { id: "merge_farmers", label: "Merge two farmer records", agent: "Intake", defaultMode: "ask", locked: false, note: "Automatic only above a match score of 0.95" },
  { id: "answer_buyer", label: "Answer a buyer question from stored evidence", agent: "Buyer liaison", defaultMode: "ask", locked: false, note: "Unsupported questions always go to a person" },
  { id: "change_allocation", label: "Change a container allocation", agent: "Shipment planner", defaultMode: "ask", locked: false },
  { id: "clear_review", label: "Clear a review plot", agent: "Geo analyst", defaultMode: "ask", locked: true },
  { id: "clear_flag", label: "Clear a supply chain flag", agent: "Supply chain auditor", defaultMode: "ask", locked: true },
  { id: "release_lot", label: "Release a lot", agent: "Shipment planner", defaultMode: "ask", locked: true },
  { id: "send_to_buyer", label: "Send an evidence pack or email to a buyer", agent: "Buyer liaison", defaultMode: "ask", locked: true },
] as const satisfies readonly AutonomyAction[];

export type AutonomyActionId = (typeof AUTONOMY_ACTIONS)[number]["id"];

/** The effective mode for an action, given what the exporter stored. */
export function autonomyMode(action: AutonomyActionId, stored: Partial<Record<string, AutonomyMode>>): AutonomyMode {
  const def = AUTONOMY_ACTIONS.find((a) => a.id === action)!;
  if (def.locked) return "ask";
  return stored[action] ?? def.defaultMode;
}

export function isAutonomyAction(id: string): id is AutonomyActionId {
  return AUTONOMY_ACTIONS.some((a) => a.id === id);
}
