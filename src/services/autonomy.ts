import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { approvals, autonomyPolicies } from "@/db/schema";
import { AUTONOMY_ACTIONS, autonomyMode, type AutonomyActionId, type AutonomyMode } from "@/domain/autonomy";

export async function getPolicies(db: Db, orgId: string): Promise<Record<string, AutonomyMode>> {
  const rows = await db.select().from(autonomyPolicies).where(eq(autonomyPolicies.orgId, orgId));
  return Object.fromEntries(rows.map((r) => [r.action, r.mode]));
}

export async function modeFor(db: Db, orgId: string, action: AutonomyActionId): Promise<AutonomyMode> {
  return autonomyMode(action, await getPolicies(db, orgId));
}

/** Locked actions cannot be changed; every change goes on the ledger. */
export async function setPolicy(db: Db, input: { orgId: string; action: AutonomyActionId; mode: AutonomyMode }) {
  const def = AUTONOMY_ACTIONS.find((a) => a.id === input.action);
  if (!def || def.locked) return { ok: false as const, message: "This action always asks a person first." };
  await db
    .insert(autonomyPolicies)
    .values({ orgId: input.orgId, action: input.action, mode: input.mode })
    .onConflictDoUpdate({ target: [autonomyPolicies.orgId, autonomyPolicies.action], set: { mode: input.mode, updatedAt: new Date().toISOString() } });
  await recordEvent(db, { orgId: input.orgId, type: "autonomy.changed", payload: { action: input.action, mode: input.mode } });
  return { ok: true as const, message: `${def.label}: ${input.mode === "auto" ? "automatic" : input.mode === "ask" ? "ask first" : "off"}.` };
}

/** Creates an approval unless an identical one is already waiting. */
export async function requestApproval(
  db: Db,
  input: { orgId: string; kind: string; subjectId: string; summary: string; payload: unknown },
): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.orgId, input.orgId), eq(approvals.kind, input.kind), eq(approvals.subjectId, input.subjectId), eq(approvals.status, "pending")));
  if (existing) return { id: existing.id, created: false };
  const [row] = await db.insert(approvals).values(input).returning({ id: approvals.id });
  await recordEvent(db, { orgId: input.orgId, type: "approval.requested", payload: { kind: input.kind, subjectId: input.subjectId, summary: input.summary } });
  return { id: row.id, created: true };
}
