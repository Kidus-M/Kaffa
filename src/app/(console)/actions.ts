"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordEvent } from "@/db/events";
import { gaps, plots } from "@/db/schema";
import { isAutonomyAction } from "@/domain/autonomy";
import { decide } from "@/services/approvals";
import { setPolicy } from "@/services/autonomy";
import { askQuestion } from "@/services/copilot";
import { auditLots, clearFlag } from "@/services/custody";
import { checkInbox } from "@/services/email-intake";
import { scanDuplicates } from "@/services/identity";
import { proposePlan } from "@/services/planner";
import { planAllVisits, sendDayPlans } from "@/services/visits";
import { seedDemo } from "@/db/seed";
import { sendChase } from "@/services/chase";
import { getAppDeps } from "@/services/deps";
import { resolveIntakeRow, type IntakeCorrection } from "@/services/intake";
import { acceptReviewPlot, removePlotFromLot } from "@/services/plots";
import { EVENTS } from "@/workflows/events";
import { consoleContext } from "@/lib/console";

export type ActionState = { ok: boolean; message: string } | null;

/** Screens every plot with a valid boundary and chases every field agent with open requests. */
export async function runChecks(): Promise<ActionState> {
  const { orgId } = await consoleContext();
  const deps = await getAppDeps();
  const all = await deps.db.select({ id: plots.id, issues: plots.issues }).from(plots).where(eq(plots.orgId, orgId));
  const screenable = all.filter((p) => !p.issues.some((i) => i.severity === "error"));
  // Six at a time: fast when screening runs inline, and gentle on the satellite API's rate limits.
  for (let i = 0; i < screenable.length; i += 6)
    await Promise.all(screenable.slice(i, i + 6).map((p) => deps.emit({ name: EVENTS.plotScreenRequested, data: { orgId, plotId: p.id } })));

  const agents = await deps.db
    .selectDistinct({ fieldAgentId: gaps.fieldAgentId })
    .from(gaps)
    .where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open")));
  let chased = 0;
  let unregistered = 0;
  for (const { fieldAgentId } of agents) {
    // The durable workflow sends the chase and waits for replies; if Inngest is unreachable, send it now.
    if (deps.integrations.workflows === "durable" && (await deps.emit({ name: EVENTS.chaseRequested, data: { orgId, fieldAgentId } }))) {
      chased++;
      continue;
    }
    const r = await sendChase(deps, { orgId, fieldAgentId });
    if (r.sent) chased++;
    else if (r.reason === "not_registered") unregistered++;
  }
  await recordEvent(deps.db, { orgId, type: "checks.requested", payload: { plots: screenable.length, fieldAgents: agents.length } });
  revalidatePath("/", "layout");
  const waiting = unregistered ? ` ${unregistered} still need to connect Telegram; share their link from Field agents.` : "";
  return { ok: true, message: `Screened ${screenable.length} plots and messaged ${chased} of ${agents.length} field agents with open requests.${waiting}` };
}

const reasonSchema = z.object({
  plotRef: z.string().regex(/^[A-Z]{3}-\d{3}$/),
  reason: z.string().trim().min(12, "Give a reason of at least 12 characters; it goes on the ledger."),
});

/** A person accepts a review plot. Locked to "ask first" by the autonomy rules. */
export async function acceptReview(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = reasonSchema.safeParse({ plotRef: form.get("plotRef"), reason: form.get("reason") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { db, orgId } = await consoleContext();
  const result = await acceptReviewPlot(db, { orgId, ...parsed.data });
  revalidatePath("/", "layout");
  return result;
}

/** The exporter takes a plot out of its lot; also locked to "ask first". */
export async function removeFromLot(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = reasonSchema.safeParse({ plotRef: form.get("plotRef"), reason: form.get("reason") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { db, orgId } = await consoleContext();
  const result = await removePlotFromLot(db, { orgId, ...parsed.data });
  revalidatePath("/", "layout");
  return result;
}

const decideSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(2000).optional(),
});

/** A person decides an approval; approving runs the action the agent asked for. */
export async function decideApproval(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = decideSchema.safeParse({ id: form.get("id"), decision: form.get("decision"), reason: form.get("reason") || undefined });
  if (!parsed.success) return { ok: false, message: "Choose approve or reject." };
  const { orgId } = await consoleContext();
  const deps = await getAppDeps();
  const result = await decide(deps, { orgId, ...parsed.data });
  revalidatePath("/", "layout");
  return result;
}

export async function proposePlanAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const { db, orgId } = await consoleContext();
  const r = await proposePlan(db, orgId);
  revalidatePath("/", "layout");
  return r;
}

export async function auditAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const { db, orgId } = await consoleContext();
  const r = await auditLots(db, orgId);
  const d = await scanDuplicates(db, orgId);
  revalidatePath("/", "layout");
  return { ok: true, message: `Checked ${r.lots} lots (${r.raised} new flags) and ${d.pairs} possible duplicate farmer pairs.` };
}

export async function clearFlagAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ flagId: z.string().min(1), reason: z.string().trim().min(12, "Give a reason of at least 12 characters; it goes on the ledger.") })
    .safeParse({ flagId: form.get("flagId"), reason: form.get("reason") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { db, orgId } = await consoleContext();
  const r = await clearFlag(db, { orgId, ...parsed.data });
  revalidatePath("/", "layout");
  return r;
}

export async function planVisitsAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const { orgId } = await consoleContext();
  const deps = await getAppDeps();
  const planned = await planAllVisits(deps, orgId);
  revalidatePath("/", "layout");
  return { ok: true, message: `Planned visits for ${planned} field agent${planned === 1 ? "" : "s"}.` };
}

export async function sendDayPlansAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const { orgId } = await consoleContext();
  const deps = await getAppDeps();
  const r = await sendDayPlans(deps, orgId);
  revalidatePath("/", "layout");
  if (r.mode === "ask") return { ok: true, message: "Day plans are waiting in Approvals, as the autonomy settings ask." };
  return { ok: true, message: `Sent ${r.sent} day plan${r.sent === 1 ? "" : "s"}.${r.notConnected ? ` ${r.notConnected} field agent(s) are not on Telegram yet.` : ""}` };
}

export async function checkInboxAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const { orgId } = await consoleContext();
  const deps = await getAppDeps();
  try {
    const r = await checkInbox({ ...deps, query: deps.gmailQuery }, orgId);
    revalidatePath("/", "layout");
    return { ok: true, message: `${r.simulated ? "Sample inbox" : "Inbox"}: ${r.processed} new email${r.processed === 1 ? "" : "s"} read, ${r.seen - r.processed} already seen.` };
  } catch (e) {
    return { ok: false, message: `Could not read the inbox: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

export async function setAutonomyAction(form: FormData): Promise<void> {
  const action = String(form.get("action") ?? "");
  const mode = String(form.get("mode") ?? "");
  if (!isAutonomyAction(action) || !["auto", "ask", "off"].includes(mode)) return;
  const { db, orgId } = await consoleContext();
  await setPolicy(db, { orgId, action, mode: mode as "auto" | "ask" | "off" });
  revalidatePath("/", "layout");
}

export type AskState = { question: string; answer: Awaited<ReturnType<typeof askQuestion>> } | { question: string; error: string } | null;

/** Ask Kaffa: the exporter's own questions, answered from the evidence and the regulation. */
export async function askKaffa(_prev: AskState, form: FormData): Promise<AskState> {
  const question = String(form.get("question") ?? "").trim().slice(0, 500);
  if (question.length < 4) return { question, error: "Ask a question in a few words." };
  const { orgId } = await consoleContext();
  const deps = await getAppDeps();
  const answer = await askQuestion(deps, { orgId, question, channel: "console", asker: "exporter" });
  return { question, answer };
}

export async function resetDemo(): Promise<void> {
  const { db } = await consoleContext();
  await seedDemo(db);
  revalidatePath("/", "layout");
}

export async function runChecksAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  return runChecks();
}

/** A person corrects or rejects a register row the intake agent was unsure about. */
export async function resolveIntake(_prev: ActionState, form: FormData): Promise<ActionState> {
  const rowId = String(form.get("rowId") ?? "");
  if (!rowId) return { ok: false, message: "Missing row." };
  const decision = form.get("decision") === "reject" ? "reject" : "accept";
  const values: IntakeCorrection = {};
  const str = (k: "farmerName" | "village" | "phone") => {
    if (!form.has(k)) return;
    const v = String(form.get(k)).trim();
    if (k === "farmerName") values.farmerName = v;
    else values[k] = v === "" ? null : v;
  };
  const num = (k: "areaHa" | "lat" | "lon") => {
    if (!form.has(k)) return;
    const v = String(form.get(k)).trim();
    const n = Number(v);
    values[k] = v === "" || !Number.isFinite(n) ? null : n;
  };
  str("farmerName");
  str("village");
  str("phone");
  num("areaHa");
  num("lat");
  num("lon");

  const { orgId } = await consoleContext();
  const deps = await getAppDeps();
  const result = await resolveIntakeRow(deps.db, { orgId, rowId, decision, values });
  if (result.ok && "plotId" in result && result.valid) {
    await deps.emit({ name: EVENTS.plotScreenRequested, data: { orgId, plotId: result.plotId } });
  }
  revalidatePath("/", "layout");
  return { ok: result.ok, message: result.message };
}
