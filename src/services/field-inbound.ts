/**
 * Handles everything a field agent sends the bot: registration, locations, photos and text.
 * Idempotent by Telegram update ID, and only registered accounts can change data.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { extractReply, type ReplyIntent } from "@/agents/field-liaison";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { approvals, fieldAgents, gaps, messages, plots, processedUpdates } from "@/db/schema";
import type { GapNeed } from "@/domain/gaps";
import { truncate6 } from "@/domain/geometry";
import type { GeminiLike } from "@/integrations/gemini";
import type { Inbound, TelegramSender } from "@/integrations/telegram";
import { EVENTS, type Emit } from "@/workflows/events";
import { recapturePlot } from "./plots";

export type InboundDeps = {
  db: Db;
  telegram: TelegramSender | null;
  gemini: GeminiLike | null;
  emit: Emit;
  appUrl: string;
};

export type InboundResult =
  | { status: "duplicate" | "unknown_sender" }
  | { status: "registered"; fieldAgentId: string }
  | { status: "handled"; intent: ReplyIntent; plotRefs: string[] };

const COPY = {
  welcome: {
    am: "እንኳን ደህና መጡ! ከታች ያለውን ቁልፍ በመጫን የእርሻ ስራዎችዎን ይመልከቱ።",
    en: "Welcome! Tap the button below to see your farm tasks.",
  },
  ack: { am: "ደርሶናል፣ እናመሰግናለን! እያጣራን ነው።", en: "Received, thank you! We're checking it now." },
  unknown:
    "This Telegram account is not registered with Kaffa. Ask your exporter for your personal link.\n" +
    "ይህ የቴሌግራም መለያ አልተመዘገበም። የግል ማስፈንጠሪያዎን ከላኪዎ ይጠይቁ።",
  openTasks: { am: "ስራዎቼ", en: "My tasks" },
} as const;

type Agent = typeof fieldAgents.$inferSelect;

async function send(deps: InboundDeps, agent: Agent, text: string, opts?: { webAppUrl?: string; buttonText?: string }) {
  if (agent.telegramChatId && deps.telegram) await deps.telegram.sendMessage(agent.telegramChatId, text, opts);
  await deps.db.insert(messages).values({
    orgId: agent.orgId,
    fieldAgentId: agent.id,
    direction: "out",
    kind: "text",
    text,
    data: { delivered: Boolean(deps.telegram), ...opts },
  });
}

export async function handleInbound(msg: Inbound, deps: InboundDeps): Promise<InboundResult> {
  const { db } = deps;
  const fresh = await db.insert(processedUpdates).values({ updateId: msg.updateId }).onConflictDoNothing().returning();
  if (fresh.length === 0) return { status: "duplicate" };
  try {
    return await process(msg, deps);
  } catch (e) {
    // Forget the update so Telegram's retry is processed instead of dropped as a duplicate.
    await db.delete(processedUpdates).where(eq(processedUpdates.updateId, msg.updateId));
    throw e;
  }
}

async function process(msg: Inbound, deps: InboundDeps): Promise<InboundResult> {
  const { db } = deps;

  if (msg.kind === "start") {
    const [agent] = msg.startPayload
      ? await db.select().from(fieldAgents).where(eq(fieldAgents.registrationToken, msg.startPayload))
      : [];
    if (!agent) {
      await deps.telegram?.sendMessage(msg.chatId, COPY.unknown);
      return { status: "unknown_sender" };
    }
    // A link works once: the token rotates, so a forwarded or leaked link cannot take over the account.
    await db
      .update(fieldAgents)
      .set({ telegramChatId: msg.chatId, registrationToken: randomBytes(24).toString("base64url") })
      .where(eq(fieldAgents.id, agent.id));
    await recordEvent(db, { orgId: agent.orgId, type: "field_agent.registered", payload: { fieldAgentId: agent.id } });
    await send(deps, { ...agent, telegramChatId: msg.chatId }, COPY.welcome[agent.language], {
      webAppUrl: `${deps.appUrl}/field`,
      buttonText: COPY.openTasks[agent.language],
    });
    return { status: "registered", fieldAgentId: agent.id };
  }

  const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.telegramChatId, msg.chatId));
  if (!agent) {
    await deps.telegram?.sendMessage(msg.chatId, COPY.unknown);
    return { status: "unknown_sender" };
  }

  await db.insert(messages).values({
    orgId: agent.orgId,
    fieldAgentId: agent.id,
    direction: "in",
    kind: msg.kind,
    text: msg.text,
    data: { location: msg.location, fileId: msg.fileId, updateId: msg.updateId },
  });

  const open = await db
    .select({ gapId: gaps.id, plotId: gaps.plotId, need: gaps.need, plotRef: plots.ref })
    .from(gaps)
    .innerJoin(plots, eq(plots.id, gaps.plotId))
    .where(and(eq(gaps.fieldAgentId, agent.id), eq(gaps.status, "open")));
  const reply = await extractReply(msg, open.map((o) => ({ plotRef: o.plotRef, need: o.need as GapNeed })), deps.gemini);
  const targets = open.filter((o) => reply.plotRefs.includes(o.plotRef));

  const rescreen: string[] = [];
  if (reply.intent === "location" && msg.location) {
    for (const t of targets) {
      const { validation } = await recapturePlot(db, {
        orgId: agent.orgId,
        plotId: t.plotId,
        geometry: { type: "Point", coordinates: [truncate6(msg.location.lon), truncate6(msg.location.lat)] },
        source: "telegram_location",
        fieldAgentId: agent.id,
      });
      if (validation.ok) rescreen.push(t.plotId);
    }
  }
  if (reply.intent === "photo") {
    const photoGaps = targets.filter((t) => t.need === "photo");
    if (photoGaps.length) {
      await db
        .update(gaps)
        .set({ status: "resolved", resolvedAt: new Date().toISOString() })
        .where(inArray(gaps.id, photoGaps.map((g) => g.gapId)));
      await db.insert(approvals).values(
        photoGaps.map((g) => ({
          orgId: agent.orgId,
          kind: "review_photo",
          subjectId: g.plotId,
          summary: `Field photo for ${g.plotRef} from ${agent.name}. Accept the review plot or ask for more evidence.`,
          payload: { fileId: msg.fileId, fieldAgentId: agent.id },
        })),
      );
    }
  }

  await recordEvent(db, {
    orgId: agent.orgId,
    type: "field.replied",
    payload: { fieldAgentId: agent.id, intent: reply.intent, plotRefs: reply.plotRefs, source: reply.source },
  });
  await deps.emit({
    name: EVENTS.fieldReplied,
    data: { orgId: agent.orgId, fieldAgentId: agent.id, intent: reply.intent, plotRefs: reply.plotRefs },
  });
  for (const plotId of rescreen) await deps.emit({ name: EVENTS.plotScreenRequested, data: { orgId: agent.orgId, plotId } });

  await send(deps, agent, COPY.ack[agent.language]);
  return { status: "handled", intent: reply.intent, plotRefs: reply.plotRefs };
}
