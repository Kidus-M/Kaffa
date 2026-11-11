/**
 * The chase's control flow, separated from Inngest so it can be tested with a fake
 * step runner. In production `step` is Inngest's step tools, which persist each step.
 */
import { CHASE_ESCALATE_HOURS, CHASE_REMINDER_HOURS } from "@/config/policy";
import type { ChaseResult } from "@/services/chase";
import { EVENTS } from "./events";

export type StepRunner = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  waitForEvent(id: string, opts: { event: string; timeout: string; match: string }): Promise<unknown>;
};

export type ChaseActions = {
  send(reminder: boolean): Promise<ChaseResult>;
  escalate(hours: number): Promise<unknown>;
};

export type ChaseOutcome =
  | { outcome: "replied" | "replied_after_reminder" | "escalated" }
  | { outcome: "not_sent"; reason: string };

export async function runChase(step: StepRunner, actions: ChaseActions): Promise<ChaseOutcome> {
  const first = await step.run("send-chase", () => actions.send(false));
  if (!first.sent) return { outcome: "not_sent", reason: first.reason };

  const wait = { event: EVENTS.fieldReplied, match: "data.fieldAgentId" };
  if (await step.waitForEvent("wait-for-reply", { ...wait, timeout: `${CHASE_REMINDER_HOURS}h` })) return { outcome: "replied" };

  await step.run("send-reminder", () => actions.send(true));
  const late = await step.waitForEvent("wait-after-reminder", { ...wait, timeout: `${CHASE_ESCALATE_HOURS - CHASE_REMINDER_HOURS}h` });
  if (late) return { outcome: "replied_after_reminder" };

  await step.run("escalate", () => actions.escalate(CHASE_ESCALATE_HOURS));
  return { outcome: "escalated" };
}
