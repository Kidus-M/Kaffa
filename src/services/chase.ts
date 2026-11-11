/**
 * The field liaison's outbound side: one grouped message per field agent, reminders,
 * a daily cap so nobody is spammed, and escalation to the exporter.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { composeChase } from "@/agents/field-liaison";
import { escalationText } from "@/agents/templates";
import { DAILY_MESSAGE_CAP } from "@/config/policy";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { approvals, farmers, fieldAgents, gaps, messages, plots } from "@/db/schema";
import type { GapNeed } from "@/domain/gaps";
import type { GeminiLike } from "@/integrations/gemini";
import type { TelegramSender } from "@/integrations/telegram";
import { startTrace } from "./trace";

export type ChaseDeps = { db: Db; telegram: TelegramSender | null; gemini: GeminiLike | null; appUrl: string };

export type ChaseResult =
  | { sent: true; plotRefs: string[]; source: "gemini" | "template" }
  | { sent: false; reason: "no_open_requests" | "not_registered" | "daily_cap" | "unknown_agent" };

async function openItems(db: Db, fieldAgentId: string) {
  return db
    .select({ gapId: gaps.id, need: gaps.need, plotRef: plots.ref, farmer: farmers.nameLatin })
    .from(gaps)
    .innerJoin(plots, eq(plots.id, gaps.plotId))
    .innerJoin(farmers, eq(farmers.id, plots.farmerId))
    .where(and(eq(gaps.fieldAgentId, fieldAgentId), eq(gaps.status, "open")))
    .orderBy(plots.ref);
}

export async function sendChase(
  deps: ChaseDeps,
  input: { orgId: string; fieldAgentId: string; reminder?: boolean },
): Promise<ChaseResult> {
  const { db } = deps;
  const [agent] = await db
    .select()
    .from(fieldAgents)
    .where(and(eq(fieldAgents.id, input.fieldAgentId), eq(fieldAgents.orgId, input.orgId)));
  if (!agent) return { sent: false, reason: "unknown_agent" };

  const items = await openItems(db, agent.id);
  if (!items.length) return { sent: false, reason: "no_open_requests" };
  if (!agent.telegramChatId || !deps.telegram) return { sent: false, reason: "not_registered" };

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [{ today }] = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.fieldAgentId, agent.id), eq(messages.direction, "out"), gte(messages.createdAt, startOfDay.toISOString())));
  if (today >= DAILY_MESSAGE_CAP) return { sent: false, reason: "daily_cap" };

  const trace = await startTrace(db, { orgId: input.orgId, agent: "field_liaison", trigger: input.reminder ? "reminder" : "chase" });
  const message = await composeChase(
    {
      agentName: agent.name.replace(" (synthetic)", ""),
      language: agent.language,
      reminder: input.reminder,
      items: items.map((i) => ({ plotRef: i.plotRef, farmer: i.farmer ?? "", need: i.need as GapNeed })),
    },
    deps.gemini,
  );
  await trace.step(deps.gemini ? "model" : "rule", "compose_chase", { items: items.length, language: agent.language }, message);

  const button = { webAppUrl: `${deps.appUrl}/field`, buttonText: agent.language === "am" ? "ስራዎቼ" : "My tasks" };
  await deps.telegram.sendMessage(agent.telegramChatId, message.text, button);
  await db.insert(messages).values({
    orgId: input.orgId,
    fieldAgentId: agent.id,
    direction: "out",
    kind: input.reminder ? "reminder" : "chase",
    text: message.text,
    data: { plotRefs: items.map((i) => i.plotRef), source: message.source },
  });
  if (input.reminder) {
    await db
      .update(gaps)
      .set({ reminders: sql`${gaps.reminders} + 1` })
      .where(inArray(gaps.id, items.map((i) => i.gapId)));
  }
  await recordEvent(db, {
    orgId: input.orgId,
    type: input.reminder ? "chase.reminded" : "chase.sent",
    payload: { fieldAgentId: agent.id, plotRefs: items.map((i) => i.plotRef), source: message.source },
  });
  await trace.finish("succeeded", `${input.reminder ? "Reminded" : "Chased"} ${agent.name} about ${items.length} plots`);
  return { sent: true, plotRefs: items.map((i) => i.plotRef), source: message.source };
}

/** No reply in time: the exporter is asked to step in. Requests stay open, so lots stay held. */
export async function escalateChase(deps: ChaseDeps, input: { orgId: string; fieldAgentId: string; hours: number }) {
  const { db } = deps;
  const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, input.fieldAgentId));
  const items = await openItems(db, input.fieldAgentId);
  if (!agent || !items.length) return { escalated: false };
  const summary = escalationText({
    agentName: agent.name,
    hours: input.hours,
    items: items.map((i) => ({ plotRef: i.plotRef, farmer: i.farmer ?? "", need: i.need as GapNeed })),
  });
  await db.insert(approvals).values({
    orgId: input.orgId,
    kind: "escalation",
    subjectId: agent.id,
    summary,
    payload: { plotRefs: items.map((i) => i.plotRef) },
  });
  await recordEvent(db, { orgId: input.orgId, type: "chase.escalated", payload: { fieldAgentId: agent.id, plotRefs: items.map((i) => i.plotRef) } });
  return { escalated: true };
}
