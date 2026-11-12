import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { bbox } from "@turf/turf";
import { gapsForPlot } from "@/domain/gaps";
import { findOverlaps, repairPlot, validatePlot } from "@/domain/geometry";
import type { Db } from "./client";
import { recordEvent } from "./events";
import * as s from "./schema";
import {
  COOPS,
  DEMO_ORG_ID,
  FARMER_PHONES,
  FIELD_AGENTS,
  LOTS,
  OVER_DELIVERY,
  SITES,
  UNMAPPED_SUPPLIER,
  RESOLUTION_HISTORY_DAYS,
  SHIPMENTS,
  buildSeedPlots,
  farmerName,
} from "./seed-data";

const DAY_MS = 86_400_000;
const ORG_TABLES = [
  s.cooperatives, s.fieldAgents, s.farmers, s.plots, s.checks, s.shipments, s.lots,
  s.gaps, s.messages, s.approvals, s.ledgerEntries, s.agentRuns, s.intakeBatches, s.intakeRows,
  s.farmerAliases, s.sites, s.deliveries, s.flags, s.autonomyPolicies, s.visitPlans, s.questions, s.inboundEmails,
] as const;

function agentFor(ref: string): string {
  if (ref.startsWith("HMB")) return "fa_chaltu";
  const n = Number(ref.slice(4));
  return n <= 10 || n > 20 ? "fa_tigist" : "fa_dawit";
}

/** The unguessable code behind each lot's public verification page; fixed for the demo. */
export const lotPublicCode = (ref: string) => createHash("sha256").update(`kaffa-demo-lot-${ref}`).digest("hex").slice(0, 12);

/** Resets the demo organisation to a known state. Every record is synthetic. */
export async function seedDemo(db: Db, now = new Date()): Promise<void> {
  const orgId = DEMO_ORG_ID;
  for (const t of ORG_TABLES) await db.delete(t).where(eq(t.orgId, orgId));
  await db.delete(s.orgs).where(eq(s.orgs.id, orgId));
  const lotIds = LOTS.map((l) => `lot_${l.ref}`);
  for (const lotId of lotIds) await db.delete(s.lotPlots).where(eq(s.lotPlots.lotId, lotId));

  await db.insert(s.orgs).values({ id: orgId, name: "Sidama Highland Exporters (synthetic)" });
  await db.insert(s.cooperatives).values(COOPS.map((c) => ({ id: c.id, orgId, name: c.name, region: c.region, synthetic: true })));
  await db.insert(s.fieldAgents).values(
    FIELD_AGENTS.map((a) => ({ id: a.id, orgId, cooperativeId: a.cooperativeId, name: a.name, registrationToken: a.token, synthetic: true })),
  );

  const seedPlots = buildSeedPlots();
  const prepared = seedPlots.map((p) => {
    let geometry = p.geometry;
    let v = validatePlot(geometry, { declaredAreaHa: p.declaredAreaHa });
    // The geo analyst applies repairs that don't move the boundary, as the autonomy rules allow.
    if (!v.ok && geometry && v.issues.every((i) => i.severity === "warning" || ["ring_not_closed", "duplicate_vertices", "has_holes"].includes(i.code))) {
      const r = repairPlot(geometry);
      if (!r.changesShape) {
        geometry = r.geometry;
        v = validatePlot(geometry, { declaredAreaHa: p.declaredAreaHa });
      }
    }
    const stored = v.geometry ?? geometry;
    const box = stored ? bbox(stored) : null;
    return { seed: p, v, stored, box, id: `plot_${p.ref}`, farmerId: `farmer_${p.ref}` };
  });

  await db.insert(s.farmers).values([
    ...prepared.map(({ seed, farmerId }) => ({
      id: farmerId,
      orgId,
      cooperativeId: seed.cooperativeId,
      ...(seed.farmer ?? farmerName(seed.farmerIndex + (seed.cooperativeId === "coop_hambela" ? 10 : 0))),
      phone: seed.farmer?.phone ?? FARMER_PHONES[seed.ref] ?? null,
      village: seed.cooperativeId === "coop_konga" ? "Konga" : "Wamena",
      synthetic: true,
    })),
    { id: UNMAPPED_SUPPLIER.id, orgId, cooperativeId: UNMAPPED_SUPPLIER.cooperativeId, name: UNMAPPED_SUPPLIER.name, nameLatin: UNMAPPED_SUPPLIER.name, village: "Buku", synthetic: true },
  ]);
  await db.insert(s.plots).values(
    prepared.map(({ seed, v, stored, box, id, farmerId }) => ({
      id,
      orgId,
      ref: seed.ref,
      farmerId,
      cooperativeId: seed.cooperativeId,
      fieldAgentId: agentFor(seed.ref),
      geometry: stored,
      declaredAreaHa: seed.declaredAreaHa,
      areaHa: v.areaHa,
      issues: v.issues,
      status: "not_checked" as const,
      statusReasons: v.ok ? ["awaiting_screening"] : ["invalid_geometry"],
      minLon: box?.[0],
      minLat: box?.[1],
      maxLon: box?.[2],
      maxLat: box?.[3],
      synthetic: true,
    })),
  );

  await db.insert(s.shipments).values(
    SHIPMENTS.map(({ lots: _lots, ...sh }) => ({ ...sh, orgId, synthetic: true })),
  );
  for (const lot of LOTS) {
    const shipment = SHIPMENTS.find((sh) => sh.lots.includes(lot.ref));
    const lotId = `lot_${lot.ref}`;
    await db.insert(s.lots).values({
      id: lotId,
      orgId,
      shipmentId: shipment?.id ?? null,
      ref: lot.ref,
      grade: lot.grade,
      quantityKg: 9_600,
      valueUsd: lot.grade.endsWith("G1") ? 57_600 : 52_800,
      publicCode: lotPublicCode(lot.ref),
      synthetic: true,
    });
    await db.insert(s.lotPlots).values(lot.plotRefs(lot.prefix).map((ref) => ({ lotId, plotId: `plot_${ref}` })));
  }

  // Chain of custody: every plot delivers to a collector or washing station, in proportion
  // to its area, so each lot's deliveries add up to its weight. Two deliberate anomalies
  // in HMB-L4 give the supply chain auditor something real to find.
  await db.insert(s.sites).values(SITES.map((site) => ({ ...site, orgId, synthetic: true })));
  const deliveryRows: (typeof s.deliveries.$inferInsert)[] = [];
  for (const lot of LOTS) {
    const lotId = `lot_${lot.ref}`;
    const members = prepared.filter((p) => lot.plotRefs(lot.prefix).includes(p.seed.ref));
    const area = (p: (typeof members)[number]) => p.v.areaHa ?? p.seed.declaredAreaHa;
    const extraKg = lot.ref === UNMAPPED_SUPPLIER.lotRef ? UNMAPPED_SUPPLIER.kg : 0;
    const over = members.find((m) => m.seed.ref === OVER_DELIVERY.plotRef);
    const overKg = over ? Math.round(area(over) * 900 * OVER_DELIVERY.factor) : 0;
    const rest = members.filter((m) => m !== over);
    const restArea = rest.reduce((t, m) => t + area(m), 0);
    const restKg = 9_600 - extraKg - overKg;
    let allocated = 0;
    rest.forEach((m, i) => {
      const kg = i === rest.length - 1 ? restKg - allocated : Math.round((restKg * area(m)) / restArea);
      allocated += kg;
      const n = Number(m.seed.ref.slice(4));
      const siteId = m.seed.cooperativeId === "coop_konga" ? (n % 2 ? "col_konga_a" : "col_konga_b") : n % 3 === 0 ? "ws_hambela" : "col_hambela";
      deliveryRows.push({ orgId, farmerId: m.farmerId, plotId: m.id, siteId, lotId, kg, deliveredOn: `2026-11-${String(1 + (n % 9)).padStart(2, "0")}`, synthetic: true });
    });
    if (over) deliveryRows.push({ orgId, farmerId: over.farmerId, plotId: over.id, siteId: "col_hambela", lotId, kg: overKg, deliveredOn: "2026-11-06", synthetic: true });
    if (extraKg) deliveryRows.push({ orgId, farmerId: UNMAPPED_SUPPLIER.id, plotId: null, siteId: "col_hambela", lotId, kg: extraKg, deliveredOn: "2026-11-07", synthetic: true });
  }
  await db.insert(s.deliveries).values(deliveryRows);

  // The demo exporter lets the buyer liaison answer portal questions from stored evidence.
  await db.insert(s.autonomyPolicies).values({ orgId, action: "answer_buyer", mode: "auto" });

  // Field requests for problems only a person on site can fix.
  const overlapping = new Set(
    findOverlaps(prepared.filter((p) => p.v.ok && p.stored).map((p) => ({ id: p.id, geometry: p.stored! }))).flatMap((o) => [o.a, o.b]),
  );
  const openGaps = prepared.flatMap(({ seed, v, id }) =>
    gapsForPlot({ issueCodes: v.issues.map((i) => i.code), status: "not_checked", overlaps: overlapping.has(id) }).map((g) => ({
      orgId,
      plotId: id,
      fieldAgentId: agentFor(seed.ref),
      need: g.need,
      reason: g.reason,
      openedAt: new Date(now.getTime() - DAY_MS).toISOString(),
    })),
  );
  if (openGaps.length) await db.insert(s.gaps).values(openGaps);

  // Past, resolved requests: the history the on-time forecast learns from.
  const history = Object.entries(RESOLUTION_HISTORY_DAYS).flatMap(([fieldAgentId, days]) =>
    days.map((d, i) => {
      const opened = now.getTime() - (30 + i * 5) * DAY_MS;
      return {
        orgId,
        plotId: "history",
        fieldAgentId,
        need: "location" as const,
        reason: "history",
        status: "resolved" as const,
        openedAt: new Date(opened).toISOString(),
        resolvedAt: new Date(opened + d * DAY_MS).toISOString(),
      };
    }),
  );
  if (history.length) await db.insert(s.gaps).values(history);

  await recordEvent(db, {
    orgId,
    type: "demo.seeded",
    payload: { plots: prepared.length, openRequests: openGaps.length, synthetic: true },
  });

  // The supply chain auditor and identity resolution run once over the fresh data.
  const { auditLots } = await import("@/services/custody");
  const { scanDuplicates } = await import("@/services/identity");
  await auditLots(db, orgId);
  await scanDuplicates(db, orgId);
}
