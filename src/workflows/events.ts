/** Event names shared by services, workflows and tests. */
export const EVENTS = {
  plotScreenRequested: "kaffa/plot.screen.requested",
  chaseRequested: "kaffa/chase.requested",
  fieldReplied: "kaffa/field.replied",
  dailyRequested: "kaffa/daily.requested",
} as const;

/** Resolves true when the event reached Inngest, false when it was handled inline or dropped. */
export type Emit = (event: { name: string; data: Record<string, unknown> }) => Promise<boolean | void>;
