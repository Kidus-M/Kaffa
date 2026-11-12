/**
 * What happens when a person decides an approval. Each kind runs its action only after
 * approval, and the decision with its note goes on the ledger.
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { approvals, fieldAgents, messages, questions, shipments, visitPlans } from "@/db/schema";
import type { Mailer } from "@/integrations/brevo";
import type { TelegramSender } from "@/integrations/telegram";
import { gradeNumber } from "@/domain/planner";
import { mergeFarmers } from "./identity";
import { applyAllocation, proposePlan } from "./planner";

export type ApprovalDeps = { db: Db; telegram: TelegramSender | null; mailer: Mailer | null };
type Row = typeof approvals.$inferSelect;
type Result = { ok: boolean; message: string };

const shipmentPayload = z.object({
  ref: z.string().nullable(),
  buyerName: z.string(),
  volumeKg: z.number().positive(),
  grade: z.string().nullable(),
  destinationPort: z.string(),
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function run(deps: ApprovalDeps, row: Row, note: string | undefined): Promise<Result> {
  const { db } = deps;
  const p = (row.payload ?? {}) as Record<string, unknown>;
  switch (row.kind) {
    case "merge_farmers":
      return mergeFarmers(db, { orgId: row.orgId, keepId: String(p.keepId), mergeId: String(p.mergeId), by: "exporter", score: Number(p.score) });
    case "change_allocation":
      return applyAllocation(db, row.orgId, p.changes as Parameters<typeof applyAllocation>[2], "exporter");
    case "create_shipment": {
      const parsed = shipmentPayload.safeParse(p);
      if (!parsed.success) return { ok: false, message: "This contract is missing its volume, port or ship date. Reject it and ask the buyer, or add the shipment by hand." };
      const s = parsed.data;
      const ref = s.ref ?? `NEW-${randomBytes(2).toString("hex").toUpperCase()}`;
      await db.insert(shipments).values({
        orgId: row.orgId,
        ref,
        buyerName: s.buyerName,
        destinationPort: s.destinationPort,
        shipDate: s.shipDate,
        contractVolumeKg: Math.round(s.volumeKg),
        gradeRequired: gradeNumber(s.grade ?? "") < 9 ? `G${gradeNumber(s.grade ?? "")}` : "G2",
        portalToken: `portal-${randomBytes(12).toString("base64url")}`,
      });
      await recordEvent(db, { orgId: row.orgId, type: "shipment.created", payload: { ref, buyer: s.buyerName, volumeKg: s.volumeKg, shipDate: s.shipDate } });
      const plan = await proposePlan(db, row.orgId);
      return { ok: true, message: `Shipment ${ref} created. ${plan.message}` };
    }
    case "buyer_answer":
      await db.update(questions).set({ status: "answered" }).where(eq(questions.id, String(p.questionId)));
      return { ok: true, message: "Answer published to the buyer portal." };
    case "send_reply": {
      const [q] = await db.select().from(questions).where(eq(questions.id, String(p.questionId)));
      if (!q?.answer) return { ok: false, message: "This draft no longer exists." };
      const text = `${q.answer.replace(/\s*\[[A-Za-z0-9-]+\]/g, "")}\n\nSources: ${q.citations.map((c) => c.label).join("; ")}`;
      let sent = false;
      if (deps.mailer && typeof p.replyTo === "string") {
        await deps.mailer.send({ to: p.replyTo, subject: String(p.subject ?? "Your question"), text });
        sent = true;
      }
      await db.update(questions).set({ status: "answered" }).where(eq(questions.id, q.id));
      await recordEvent(db, { orgId: row.orgId, type: sent ? "email.sent" : "email.approved", payload: { to: p.replyTo ?? q.asker, questionId: q.id } });
      return { ok: true, message: sent ? "Reply sent." : "Reply approved. Email sending is not configured, so copy it from the question log." };
    }
    case "buyer_question": {
      if (!note || note.length < 12) return { ok: false, message: "Write your answer in the note (at least 12 characters); it is what the buyer will see." };
      await db.update(questions).set({ status: "answered", answer: note, mode: "person" }).where(eq(questions.id, String(p.questionId)));
      return { ok: true, message: "Your answer is published to the buyer." };
    }
    case "send_day_plan": {
      const [plan] = await db.select().from(visitPlans).where(eq(visitPlans.id, String(p.planId)));
      const [agent] = plan ? await db.select().from(fieldAgents).where(eq(fieldAgents.id, plan.fieldAgentId)) : [];
      if (!agent?.telegramChatId || !deps.telegram) return { ok: true, message: "Approved, but this field agent is not connected to Telegram yet." };
      await deps.telegram.sendMessage(agent.telegramChatId, String(p.text));
      await db.insert(messages).values({ orgId: row.orgId, fieldAgentId: agent.id, direction: "out", kind: "day_plan", text: String(p.text) });
      await db.update(visitPlans).set({ sentAt: new Date().toISOString() }).where(eq(visitPlans.id, plan.id));
      return { ok: true, message: "Day plan sent." };
    }
    default:
      return { ok: true, message: "Decision recorded." };
  }
}

export async function decide(deps: ApprovalDeps, input: { orgId: string; id: string; decision: "approved" | "rejected"; reason?: string }): Promise<Result> {
  const { db } = deps;
  const [row] = await db.select().from(approvals).where(and(eq(approvals.id, input.id), eq(approvals.orgId, input.orgId), eq(approvals.status, "pending")));
  if (!row) return { ok: false, message: "This approval was already decided." };
  if (input.decision === "approved") {
    const r = await run(deps, row, input.reason);
    if (!r.ok) return r;
    await finish(db, row, input);
    return r;
  }
  await finish(db, row, input);
  return { ok: true, message: "Rejected; the reason is on the ledger." };
}

async function finish(db: Db, row: Row, input: { decision: "approved" | "rejected"; reason?: string }) {
  await db
    .update(approvals)
    .set({ status: input.decision, reason: input.reason, decidedBy: "exporter", decidedAt: new Date().toISOString() })
    .where(eq(approvals.id, row.id));
  await recordEvent(db, { orgId: row.orgId, type: `approval.${input.decision}`, payload: { kind: row.kind, subjectId: row.subjectId, reason: input.reason } });
}
