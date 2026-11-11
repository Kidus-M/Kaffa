/** Event names shared by services, workflows and tests. */
export const EVENTS = {
  plotScreenRequested: "kaffa/plot.screen.requested",
  chaseRequested: "kaffa/chase.requested",
  fieldReplied: "kaffa/field.replied",
  dailyRequested: "kaffa/daily.requested",
} as const;

export type Emit = (event: { name: string; data: Record<string, unknown> }) => Promise<void>;
