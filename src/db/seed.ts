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
  FIELD_AGENTS,
  LOTS,
  RESOLUTION_HISTORY_DAYS,
  SHIPMENTS,
  buildSeedPlots,
  farmerName,
} from "./seed-data";

const DAY_MS = 86_400_000;
const ORG_TABLES = [
  s.cooperatives, s.fieldAgents, s.farmers, s.plots, s.checks, s.shipments, s.lots,
  s.gaps, s.messages, s.approvals, s.ledgerEntries, s.agentRuns,
] as const;

function agentFor(ref: string): string {
  if (ref.startsWith("HMB")) return "fa_chaltu";
  return Number(ref.slice(4)) <= 10 ? "fa_tigist" : "fa_dawit";
}

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

  await db.insert(s.farmers).values(
    prepared.map(({ seed, farmerId }) => ({
      id: farmerId,
      orgId,
      cooperativeId: seed.cooperativeId,
      ...farmerName(seed.farmerIndex + (seed.cooperativeId === "coop_hambela" ? 10 : 0)),
      village: seed.cooperativeId === "coop_konga" ? "Konga" : "Wamena",
      synthetic: true,
    })),
  );
  await db.insert(s.plots).values(
    prepared.map(({ seed, v, stored, box, id, farmerId }) => ({
      id,
      orgId,
      ref: seed.ref,
      farmerId,
      cooperativeId: seed.cooperativeId,
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
    const shipment = SHIPMENTS.find((sh) => sh.lots.includes(lot.ref))!;
    const lotId = `lot_${lot.ref}`;
    await db.insert(s.lots).values({
      id: lotId,
      orgId,
      shipmentId: shipment.id,
      ref: lot.ref,
      grade: lot.grade,
      quantityKg: 9_600,
      valueUsd: 57_600,
      synthetic: true,
    });
    await db.insert(s.lotPlots).values(lot.plotRefs(lot.prefix).map((ref) => ({ lotId, plotId: `plot_${ref}` })));
  }

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
}
