"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordEvent } from "@/db/events";
import { approvals, gaps, plots } from "@/db/schema";
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
  for (const p of screenable) await deps.emit({ name: EVENTS.plotScreenRequested, data: { orgId, plotId: p.id } });

  const agents = await deps.db
    .selectDistinct({ fieldAgentId: gaps.fieldAgentId })
    .from(gaps)
    .where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open")));
  let chased = 0;
  let unregistered = 0;
  for (const { fieldAgentId } of agents) {
    if (deps.integrations.workflows === "durable") {
      await deps.emit({ name: EVENTS.chaseRequested, data: { orgId, fieldAgentId } });
      chased++;
    } else {
      const r = await sendChase(deps, { orgId, fieldAgentId });
      if (r.sent) chased++;
      else if (r.reason === "not_registered") unregistered++;
    }
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
  reason: z.string().trim().max(500).optional(),
});

export async function decideApproval(form: FormData): Promise<void> {
  const parsed = decideSchema.safeParse({ id: form.get("id"), decision: form.get("decision"), reason: form.get("reason") || undefined });
  if (!parsed.success) return;
  const { db, orgId } = await consoleContext();
  const [row] = await db
    .update(approvals)
    .set({ status: parsed.data.decision, reason: parsed.data.reason, decidedBy: "exporter", decidedAt: new Date().toISOString() })
    .where(and(eq(approvals.id, parsed.data.id), eq(approvals.orgId, orgId), eq(approvals.status, "pending")))
    .returning();
  if (row) {
    await recordEvent(db, { orgId, type: `approval.${parsed.data.decision}`, payload: { kind: row.kind, subjectId: row.subjectId, reason: parsed.data.reason } });
  }
  revalidatePath("/", "layout");
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
