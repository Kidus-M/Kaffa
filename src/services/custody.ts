/**
 * Supply chain auditor: checks every lot's delivered volume against what its source
 * plots could grow, raises flags that hold the lot, and builds the custody graph.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { deliveries, farmers, flags, lots, plots, shipments, sites } from "@/db/schema";
import { buildCustodyGraph, checkLotVolumes, type CustodyPlot, type VolumeFinding } from "@/domain/custody";
import { refreshLotsByIds } from "./lots";
import { startTrace } from "./trace";

async function lotInputs(db: Db, orgId: string, lotId: string) {
  const dels = await db.select().from(deliveries).where(and(eq(deliveries.orgId, orgId), eq(deliveries.lotId, lotId)));
  const farmerIds = [...new Set(dels.map((d) => d.farmerId))];
  const farmerPlots: CustodyPlot[] = farmerIds.length
    ? await db
        .select({ id: plots.id, ref: plots.ref, farmerId: plots.farmerId, areaHa: plots.areaHa, declaredAreaHa: plots.declaredAreaHa })
        .from(plots)
        .where(and(eq(plots.orgId, orgId), inArray(plots.farmerId, farmerIds)))
    : [];
  return { dels, farmerPlots };
}

const findingKey = (f: { kind: string; subjectId: string }) => `${f.kind}:${f.subjectId}`;

/**
 * Re-checks lots and syncs their flags: new findings raise flags (which hold the lot),
 * and flags whose finding no longer holds after the data changed are closed by the
 * auditor with that reason. A person clears a flag that still holds.
 */
export async function auditLots(db: Db, orgId: string, lotIds?: string[]) {
  const lotRows = await db
    .select({ id: lots.id, ref: lots.ref })
    .from(lots)
    .where(lotIds ? and(eq(lots.orgId, orgId), inArray(lots.id, lotIds)) : eq(lots.orgId, orgId));
  const trace = await startTrace(db, { orgId, agent: "supply_chain_auditor", trigger: lotIds ? "data_changed" : "audit" });
  let raised = 0;
  for (const lot of lotRows) {
    const { dels, farmerPlots } = await lotInputs(db, orgId, lot.id);
    const findings = checkLotVolumes({ lotId: lot.id, deliveries: dels, plots: farmerPlots });
    await trace.step("rule", "check_volumes", { lotRef: lot.ref, deliveries: dels.length }, { findings: findings.map((f) => f.kind) });

    const existing = await db.select().from(flags).where(and(eq(flags.lotId, lot.id), eq(flags.status, "open")));
    const found = new Set(findings.map(findingKey));
    for (const f of findings) {
      if (existing.some((e) => findingKey(e) === findingKey(f))) continue;
      await db.insert(flags).values({ orgId, kind: f.kind, lotId: lot.id, subjectId: f.subjectId, detail: f });
      await recordEvent(db, { orgId, type: "flag.raised", payload: { lotRef: lot.ref, kind: f.kind, deliveredKg: f.deliveredKg } });
      raised++;
    }
    for (const e of existing.filter((x) => !found.has(findingKey(x)))) {
      await db.update(flags).set({ status: "cleared", reason: "No longer found after the records changed", clearedAt: new Date().toISOString() }).where(eq(flags.id, e.id));
      await recordEvent(db, { orgId, type: "flag.closed", payload: { lotRef: lot.ref, kind: e.kind, by: "supply chain auditor" } });
    }
  }
  await refreshLotsByIds(db, orgId, lotRows.map((l) => l.id));
  await trace.finish("succeeded", `Checked ${lotRows.length} lot(s); ${raised} new flag(s)`);
  return { lots: lotRows.length, raised };
}

/** A person clears a flag with a reason, such as a verified second plot. Locked to "ask first". */
export async function clearFlag(db: Db, input: { orgId: string; flagId: string; reason: string }) {
  const [flag] = await db
    .update(flags)
    .set({ status: "cleared", reason: input.reason, clearedAt: new Date().toISOString() })
    .where(and(eq(flags.id, input.flagId), eq(flags.orgId, input.orgId), eq(flags.status, "open")))
    .returning();
  if (!flag) return { ok: false as const, message: "This flag is no longer open." };
  const [lot] = await db.select({ ref: lots.ref }).from(lots).where(eq(lots.id, flag.lotId));
  await recordEvent(db, { orgId: input.orgId, type: "flag.cleared", payload: { lotRef: lot?.ref, kind: flag.kind, reason: input.reason, by: "exporter" } });
  await refreshLotsByIds(db, input.orgId, [flag.lotId]);
  return { ok: true as const, message: "Flag cleared; the reason is on the ledger." };
}

export type FlagView = { id: string; kind: VolumeFinding["kind"]; detail: VolumeFinding; subject: string; status: "open" | "cleared"; reason: string | null };

/** Everything the supply chain page shows for one lot. */
export async function getCustody(db: Db, orgId: string, lotRef: string) {
  const [lot] = await db.select().from(lots).where(and(eq(lots.orgId, orgId), eq(lots.ref, lotRef)));
  if (!lot) return null;
  const [shipment] = lot.shipmentId ? await db.select({ id: shipments.id, ref: shipments.ref }).from(shipments).where(eq(shipments.id, lot.shipmentId)) : [];
  const { dels, farmerPlots } = await lotInputs(db, orgId, lot.id);
  const siteRows = await db.select().from(sites).where(eq(sites.orgId, orgId));
  const flagRows = await db.select().from(flags).where(eq(flags.lotId, lot.id));
  const farmerRows = dels.length
    ? await db.select({ id: farmers.id, name: farmers.name, nameLatin: farmers.nameLatin }).from(farmers).where(inArray(farmers.id, [...new Set(dels.map((d) => d.farmerId))]))
    : [];
  const farmerName = (id: string) => {
    const f = farmerRows.find((x) => x.id === id);
    return f ? (f.nameLatin ?? f.name) : "Unknown farmer";
  };
  const open = flagRows.filter((f) => f.status === "open");
  const graph = buildCustodyGraph({
    lot: { id: lot.id, ref: lot.ref },
    shipment: shipment ?? null,
    deliveries: dels,
    plots: farmerPlots,
    sites: siteRows,
    flaggedFarmers: new Set(open.filter((f) => f.kind !== "volume_lot").map((f) => f.subjectId)),
  });
  const deliveredKg = dels.reduce((s, d) => s + d.kg, 0);
  return {
    lot,
    shipment: shipment ?? null,
    graph,
    deliveredKg,
    suppliers: new Set(dels.map((d) => d.farmerId)).size,
    flags: flagRows.map(
      (f): FlagView => ({
        id: f.id,
        kind: f.kind,
        detail: f.detail as VolumeFinding,
        subject: f.kind === "volume_lot" ? lot.ref : farmerName(f.subjectId),
        status: f.status,
        reason: f.reason,
      }),
    ),
  };
}

/** One row per lot for the supply chain overview. */
export async function getLotVolumes(db: Db, orgId: string) {
  const lotRows = await db.select().from(lots).where(eq(lots.orgId, orgId)).orderBy(lots.ref);
  const dels = await db.select({ lotId: deliveries.lotId, kg: deliveries.kg, farmerId: deliveries.farmerId }).from(deliveries).where(eq(deliveries.orgId, orgId));
  const openFlags = await db.select({ lotId: flags.lotId }).from(flags).where(and(eq(flags.orgId, orgId), eq(flags.status, "open")));
  return lotRows.map((l) => ({
    ref: l.ref,
    grade: l.grade,
    state: l.state,
    quantityKg: l.quantityKg,
    deliveredKg: dels.filter((d) => d.lotId === l.id).reduce((s, d) => s + d.kg, 0),
    suppliers: new Set(dels.filter((d) => d.lotId === l.id).map((d) => d.farmerId)).size,
    openFlags: openFlags.filter((f) => f.lotId === l.id).length,
  }));
}
