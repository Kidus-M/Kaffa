/**
 * Turns triaged register rows into farmers and plots. Confident rows become plots,
 * validated by the same rules as every other plot; uncertain rows wait for a person.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { bbox } from "@turf/turf";
import { rowToPlotInput, triage, type IntakeField, type IntakeRow } from "@/agents/intake";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { cooperatives, farmers, fieldAgents, gaps, intakeBatches, intakeRows, plots } from "@/db/schema";
import { gapsForPlot } from "@/domain/gaps";
import { checkNewFarmer } from "./identity";
import { startTrace, type Trace } from "./trace";

const GEEZ = /[ሀ-፿ⶀ-⷟꬀-꬯]/;

async function nextRef(db: Db, orgId: string, cooperativeId: string): Promise<string> {
  const refs = await db.select({ ref: plots.ref }).from(plots).where(and(eq(plots.orgId, orgId), eq(plots.cooperativeId, cooperativeId)));
  const parsed = refs.map((r) => /^([A-Z]{3})-(\d{3,})$/.exec(r.ref)).filter((m): m is RegExpExecArray => Boolean(m));
  let prefix = parsed[0]?.[1];
  if (!prefix) {
    const [coop] = await db.select({ name: cooperatives.name }).from(cooperatives).where(eq(cooperatives.id, cooperativeId));
    prefix = (coop?.name.replace(/[^A-Za-z]/g, "").slice(0, 3) || "NEW").toUpperCase().padEnd(3, "X");
  }
  const max = Math.max(0, ...parsed.filter((m) => m[1] === prefix).map((m) => Number(m[2])));
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** The cooperative's field agent with the fewest plots takes the new one. */
async function leastLoadedAgent(db: Db, orgId: string, cooperativeId: string): Promise<string | null> {
  const [agent] = await db
    .select({ id: fieldAgents.id })
    .from(fieldAgents)
    .where(and(eq(fieldAgents.orgId, orgId), eq(fieldAgents.cooperativeId, cooperativeId)))
    .orderBy(sql`(select count(*) from ${plots} where ${plots.fieldAgentId} = ${fieldAgents.id})`, asc(fieldAgents.name))
    .limit(1);
  return agent?.id ?? null;
}

async function createPlotFromRow(db: Db, input: { orgId: string; cooperativeId: string; row: IntakeRow; trace?: Trace }) {
  const p = rowToPlotInput(input.row);
  const ref = await nextRef(db, input.orgId, input.cooperativeId);
  const fieldAgentId = await leastLoadedAgent(db, input.orgId, input.cooperativeId);
  const [farmer] = await db
    .insert(farmers)
    .values({
      orgId: input.orgId,
      cooperativeId: input.cooperativeId,
      name: p.farmerName,
      nameLatin: GEEZ.test(p.farmerName) ? null : p.farmerName,
      village: p.village,
      phone: p.phone,
    })
    .returning({ id: farmers.id });
  const stored = p.validation.geometry ?? p.geometry;
  const box = Number.isFinite(stored.coordinates[0]) ? bbox(stored) : null;
  const [plot] = await db
    .insert(plots)
    .values({
      orgId: input.orgId,
      ref,
      farmerId: farmer.id,
      cooperativeId: input.cooperativeId,
      fieldAgentId,
      geometry: stored,
      declaredAreaHa: p.declaredAreaHa,
      areaHa: p.validation.areaHa,
      issues: p.validation.issues,
      statusReasons: [p.validation.ok ? "awaiting_screening" : "invalid_geometry"],
      minLon: box?.[0],
      minLat: box?.[1],
      maxLon: box?.[2],
      maxLat: box?.[3],
    })
    .returning({ id: plots.id });
  // Identity resolution: is this farmer already on record under another spelling?
  await checkNewFarmer(db, input.orgId, farmer.id, input.trace);
  const requests = gapsForPlot({ issueCodes: p.validation.issues.map((i) => i.code), status: "not_checked", overlaps: false });
  if (requests.length && fieldAgentId) {
    await db.insert(gaps).values(requests.map((g) => ({ orgId: input.orgId, plotId: plot.id, fieldAgentId, need: g.need, reason: g.reason })));
  }
  return { plotId: plot.id, ref, valid: p.validation.ok };
}

export async function createIntakeBatch(
  db: Db,
  input: {
    orgId: string;
    cooperativeId: string;
    source: "spreadsheet" | "photo";
    fileName: string;
    rows: IntakeRow[];
    usage?: { inputTokens: number; outputTokens: number };
  },
) {
  const trace = await startTrace(db, { orgId: input.orgId, agent: "intake", trigger: input.fileName });
  if (input.usage) {
    trace.addUsage(input.usage);
    await trace.step("model", "read_register_photo", { fileName: input.fileName }, { rows: input.rows.length });
  } else {
    await trace.step("tool", "read_spreadsheet", { fileName: input.fileName }, { rows: input.rows.length });
  }
  const { accepted, review } = triage(input.rows);
  await trace.step("rule", "triage", { threshold: 0.8 }, { confident: accepted.length, review: review.length });

  const [batch] = await db
    .insert(intakeBatches)
    .values({
      orgId: input.orgId,
      cooperativeId: input.cooperativeId,
      source: input.source,
      fileName: input.fileName,
      rowCount: input.rows.length,
      createdCount: accepted.length,
      reviewCount: review.length,
    })
    .returning({ id: intakeBatches.id });

  const created: { plotId: string; ref: string; valid: boolean }[] = [];
  for (const [i, row] of input.rows.entries()) {
    const pending = review.find((r) => r.row === row);
    if (pending) {
      await db.insert(intakeRows).values({ orgId: input.orgId, batchId: batch.id, idx: i, data: row, reviewFields: pending.fields, status: "pending" });
      continue;
    }
    const plot = await createPlotFromRow(db, { orgId: input.orgId, cooperativeId: input.cooperativeId, row, trace });
    created.push(plot);
    await db.insert(intakeRows).values({ orgId: input.orgId, batchId: batch.id, idx: i, data: row, status: "accepted", plotId: plot.plotId });
  }
  await trace.step("tool", "create_plots", null, { refs: created.map((c) => c.ref), flagged: created.filter((c) => !c.valid).map((c) => c.ref) });

  await recordEvent(db, {
    orgId: input.orgId,
    type: "intake.batch_received",
    payload: { fileName: input.fileName, source: input.source, rows: input.rows.length, created: created.map((c) => c.ref), review: review.length },
  });
  await trace.finish("succeeded", `${input.fileName}: ${created.length} plots created, ${review.length} rows to review`);
  return {
    batchId: batch.id,
    created: created.length,
    review: review.length,
    createdRefs: created.map((c) => c.ref),
    screenable: created.filter((c) => c.valid).map((c) => c.plotId),
  };
}

export type IntakeCorrection = Partial<{ farmerName: string; village: string | null; phone: string | null; areaHa: number | null; lat: number | null; lon: number | null }>;

/** A person corrects or rejects a queued row. Corrected values count as certain. */
export async function resolveIntakeRow(
  db: Db,
  input: { orgId: string; rowId: string; decision: "accept" | "reject"; values?: IntakeCorrection },
) {
  const [pending] = await db
    .select({ row: intakeRows, cooperativeId: intakeBatches.cooperativeId })
    .from(intakeRows)
    .innerJoin(intakeBatches, eq(intakeBatches.id, intakeRows.batchId))
    .where(and(eq(intakeRows.id, input.rowId), eq(intakeRows.orgId, input.orgId), eq(intakeRows.status, "pending")));
  if (!pending) return { ok: false as const, message: "This row is no longer waiting for review." };

  if (input.decision === "reject") {
    await db.update(intakeRows).set({ status: "rejected" }).where(eq(intakeRows.id, input.rowId));
    await recordEvent(db, { orgId: input.orgId, type: "intake.row_rejected", payload: { rowId: input.rowId } });
    return { ok: true as const, message: "Row rejected." };
  }

  const row = structuredClone(pending.row.data as IntakeRow);
  for (const [k, v] of Object.entries(input.values ?? {}) as [IntakeField, never][]) {
    (row[k] as { value: unknown; confidence: number }) = { value: v ?? (k === "farmerName" ? "" : null), confidence: 1 };
  }
  const { review } = triage([row]);
  if (review.length) {
    await db.update(intakeRows).set({ data: row, reviewFields: review[0].fields }).where(eq(intakeRows.id, input.rowId));
    return { ok: false as const, message: `Still missing or uncertain: ${review[0].fields.join(", ")}.` };
  }
  const plot = await createPlotFromRow(db, { orgId: input.orgId, cooperativeId: pending.cooperativeId, row });
  await db.update(intakeRows).set({ data: row, status: "accepted", plotId: plot.plotId, reviewFields: [] }).where(eq(intakeRows.id, input.rowId));
  await recordEvent(db, { orgId: input.orgId, type: "intake.row_accepted", payload: { rowId: input.rowId, plotRef: plot.ref, by: "exporter" } });
  return { ok: true as const, message: `${plot.ref} created.`, plotRef: plot.ref, plotId: plot.plotId, valid: plot.valid };
}
