/**
 * Buyer emails become work: a contract becomes a proposed shipment, a question gets a
 * cited draft answer, and anything else is recorded and left alone. Every email is
 * processed once, by its Gmail id.
 */
import { and, desc, eq } from "drizzle-orm";
import { extractEmail } from "@/agents/email";
import { SAMPLE_EMAILS } from "@/agents/sample-emails";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { inboundEmails } from "@/db/schema";
import type { GeminiLike } from "@/integrations/gemini";
import type { GmailClient, RawEmail } from "@/integrations/gmail";
import { emailAddress } from "@/integrations/brevo";
import { requestApproval } from "./autonomy";
import { askQuestion, shipmentForText } from "./copilot";
import { startTrace } from "./trace";

export type EmailDeps = { db: Db; gemini: GeminiLike | null };

export async function processEmail(deps: EmailDeps, input: { orgId: string; email: RawEmail; simulated: boolean }) {
  const { db } = deps;
  const { email, orgId } = input;
  const [seen] = await db.select({ id: inboundEmails.id }).from(inboundEmails).where(and(eq(inboundEmails.orgId, orgId), eq(inboundEmails.messageId, email.messageId)));
  if (seen) return { duplicate: true as const };

  const trace = await startTrace(db, { orgId, agent: "intake", trigger: `email: ${email.subject.slice(0, 60)}` });
  const r = await extractEmail(deps.gemini, email);
  if (r.usage) trace.addUsage(r.usage);
  await trace.step(r.mode === "gemini" ? "model" : "rule", "read_email", { subject: email.subject, attachments: email.attachments.length }, r.data);

  let outcome = "Recorded; nothing to act on.";
  if (r.data.kind === "contract" && r.data.contract) {
    const c = r.data.contract;
    const missing = (["volumeKg", "shipDate", "destinationPort"] as const).filter((k) => c[k] == null);
    await requestApproval(db, {
      orgId,
      kind: "create_shipment",
      subjectId: email.messageId,
      summary: `New contract ${c.ref ?? "(no reference)"} from ${r.data.buyerName ?? email.from}: ${c.volumeKg ? `${(c.volumeKg / 1000).toFixed(1)} t` : "volume unknown"} ${c.grade ?? ""} to ${c.destinationPort ?? "an unknown port"} by ${c.shipDate ?? "an unknown date"}.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}`,
      payload: { ...c, buyerName: r.data.buyerName ?? email.from, from: email.from, mode: r.mode },
    });
    outcome = "Proposed a new shipment for approval.";
  } else if (r.data.kind === "question" && r.data.question) {
    const shipment = await shipmentForText(db, orgId, `${email.subject} ${email.body}`, r.data.buyerName);
    const a = await askQuestion(deps, { orgId, question: r.data.question, channel: "email",
      asker: r.data.buyerName ?? email.from,
      shipmentId: shipment?.id ?? null,
      replyTo: emailAddress(email.from),
      subject: `Re: ${email.subject}`,
    });
    outcome = a.status === "needs_person" ? "Question passed to the exporter: no source supports an answer." : "Drafted a cited reply for approval.";
  }
  await db.insert(inboundEmails).values({
    orgId,
    messageId: email.messageId,
    fromAddress: email.from,
    subject: email.subject,
    body: email.body,
    receivedAt: email.receivedAt,
    kind: r.data.kind,
    extracted: { ...r.data, mode: r.mode },
    outcome,
    simulated: input.simulated,
  });
  await recordEvent(db, { orgId, type: "email.received", payload: { subject: email.subject, kind: r.data.kind, outcome } });
  await trace.finish("succeeded", `${r.data.kind}: ${outcome}`);
  return { duplicate: false as const, kind: r.data.kind, outcome };
}

/** Reads the inbox (or the recorded sample inbox when Gmail is not connected). */
export async function checkInbox(deps: EmailDeps & { gmail: GmailClient | null; query: string }, orgId: string) {
  const simulated = !deps.gmail;
  const emails = deps.gmail ? await deps.gmail.listNew(deps.query) : SAMPLE_EMAILS;
  let processed = 0;
  for (const email of emails) {
    const r = await processEmail(deps, { orgId, email, simulated });
    if (!r.duplicate) processed++;
  }
  return { processed, seen: emails.length, simulated };
}

export async function getInboundEmails(db: Db, orgId: string) {
  return db.select().from(inboundEmails).where(eq(inboundEmails.orgId, orgId)).orderBy(desc(inboundEmails.receivedAt)).limit(20);
}
