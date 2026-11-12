/**
 * Identity resolution in the database: finds farmers recorded twice, proposes merges
 * with reasons, and merges records keeping every spelling as an alias.
 */
import { and, eq, inArray } from "drizzle-orm";
import { MERGE_AUTO_SCORE } from "@/config/policy";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { deliveries, farmerAliases, farmers, lots, plots } from "@/db/schema";
import { findDuplicatePairs, findMatches, type Person } from "@/domain/identity";
import { modeFor, requestApproval } from "./autonomy";
import type { Trace } from "./trace";

async function people(db: Db, orgId: string): Promise<(Person & { label: string })[]> {
  const rows = await db.select().from(farmers).where(eq(farmers.orgId, orgId));
  const aliases = await db.select().from(farmerAliases).where(eq(farmerAliases.orgId, orgId));
  return rows.map((f) => ({
    id: f.id,
    label: f.nameLatin && f.nameLatin !== f.name ? `${f.name} (${f.nameLatin})` : f.name,
    names: [f.name, f.nameLatin ?? "", ...aliases.filter((a) => a.farmerId === f.id).map((a) => a.name)].filter(Boolean),
    village: f.village,
    phone: f.phone,
    cooperativeId: f.cooperativeId,
  }));
}

export type MergePayload = { keepId: string; mergeId: string; keepLabel: string; mergeLabel: string; score: number; reasons: string[] };

async function propose(db: Db, orgId: string, p: MergePayload, trace?: Trace) {
  const mode = await modeFor(db, orgId, "merge_farmers");
  if (mode === "auto" && p.score >= MERGE_AUTO_SCORE) {
    await mergeFarmers(db, { orgId, keepId: p.keepId, mergeId: p.mergeId, by: "intake agent", score: p.score });
    await trace?.step("rule", "merge_farmers", { score: p.score, mode }, { merged: true });
    return "merged" as const;
  }
  if (mode === "off") return "off" as const;
  const pair = [p.keepId, p.mergeId].sort().join("+");
  await requestApproval(db, {
    orgId,
    kind: "merge_farmers",
    subjectId: pair,
    summary: `${p.mergeLabel} looks like ${p.keepLabel} (match ${Math.round(p.score * 100)}%): ${p.reasons.join("; ")}.`,
    payload: p,
  });
  await trace?.step("rule", "propose_merge", { score: p.score, mode }, { approval: true, reasons: p.reasons });
  return "proposed" as const;
}

/** After intake creates a farmer: is this someone already on record? */
export async function checkNewFarmer(db: Db, orgId: string, farmerId: string, trace?: Trace) {
  const all = await people(db, orgId);
  const me = all.find((p) => p.id === farmerId);
  if (!me) return null;
  const [best] = findMatches(me, all);
  if (!best) return null;
  const keep = all.find((p) => p.id === best.id)!;
  return propose(db, orgId, { keepId: keep.id, mergeId: me.id, keepLabel: keep.label, mergeLabel: me.label, score: best.score, reasons: best.reasons }, trace);
}

/** Scans every farmer for likely duplicates and proposes a merge for each pair. */
export async function scanDuplicates(db: Db, orgId: string) {
  const all = await people(db, orgId);
  const pairs = findDuplicatePairs(all);
  let proposed = 0;
  for (const pair of pairs) {
    const a = all.find((p) => p.id === pair.a)!;
    const b = all.find((p) => p.id === pair.b)!;
    // Keep the record written in Ge'ez script, which is usually the cooperative's original register.
    const [keep, merge] = /[ሀ-፿]/.test(b.names[0]) && !/[ሀ-፿]/.test(a.names[0]) ? [b, a] : [a, b];
    const r = await propose(db, orgId, { keepId: keep.id, mergeId: merge.id, keepLabel: keep.label, mergeLabel: merge.label, score: pair.score, reasons: pair.reasons });
    if (r !== "off") proposed++;
  }
  return { pairs: pairs.length, proposed };
}

/** Merges `mergeId` into `keepId`: plots and deliveries move, every spelling is kept as an alias. */
export async function mergeFarmers(db: Db, input: { orgId: string; keepId: string; mergeId: string; by: string; score?: number }) {
  const rows = await db.select().from(farmers).where(and(eq(farmers.orgId, input.orgId), inArray(farmers.id, [input.keepId, input.mergeId])));
  const keep = rows.find((r) => r.id === input.keepId);
  const merge = rows.find((r) => r.id === input.mergeId);
  if (!keep || !merge) return { ok: false as const, message: "One of these farmers no longer exists." };

  for (const name of [merge.name, merge.nameLatin].filter((n): n is string => Boolean(n)))
    await db.insert(farmerAliases).values({ orgId: input.orgId, farmerId: keep.id, name, village: merge.village, phone: merge.phone, source: `merge by ${input.by}` });
  await db.update(farmerAliases).set({ farmerId: keep.id }).where(eq(farmerAliases.farmerId, merge.id));
  const moved = await db.update(plots).set({ farmerId: keep.id }).where(eq(plots.farmerId, merge.id)).returning({ ref: plots.ref });
  const touched = await db.update(deliveries).set({ farmerId: keep.id }).where(eq(deliveries.farmerId, merge.id)).returning({ lotId: deliveries.lotId });
  await db
    .update(farmers)
    .set({ phone: keep.phone ?? merge.phone, nameLatin: keep.nameLatin ?? merge.nameLatin, village: keep.village ?? merge.village })
    .where(eq(farmers.id, keep.id));
  await db.delete(farmers).where(eq(farmers.id, merge.id));
  await recordEvent(db, {
    orgId: input.orgId,
    type: "farmer.merged",
    payload: { keep: keep.nameLatin ?? keep.name, merged: merge.nameLatin ?? merge.name, plotRefs: moved.map((m) => m.ref), by: input.by, score: input.score },
  });

  // Combined deliveries are checked against combined plots.
  const lotIds = [...new Set(touched.map((t) => t.lotId))];
  if (lotIds.length) {
    const { auditLots } = await import("./custody");
    const lotRows = await db.select({ id: lots.id }).from(lots).where(inArray(lots.id, lotIds));
    await auditLots(db, input.orgId, lotRows.map((l) => l.id));
  }
  return { ok: true as const, message: `Merged into ${keep.nameLatin ?? keep.name}; ${moved.length} plot(s) moved.` };
}
