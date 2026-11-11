import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { bbox } from "@turf/turf";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { gaps, lotPlots, lots, plots } from "@/db/schema";
import { findOverlaps, validatePlot } from "@/domain/geometry";
import type { PlotGeometry } from "@/domain/types";
import { refreshLotsByIds } from "./lots";

const FIELD_GEOMETRY_NEEDS = ["boundary", "location", "confirm"] as const;

/** Other plots of the organisation whose bounding box touches this one, checked for real overlap. */
async function overlapsWith(db: Db, orgId: string, plotId: string, geometry: PlotGeometry) {
  if (geometry.type === "Point") return [];
  const [minLon, minLat, maxLon, maxLat] = bbox(geometry);
  const near = await db
    .select({ id: plots.id, ref: plots.ref, geometry: plots.geometry })
    .from(plots)
    .where(
      and(
        eq(plots.orgId, orgId),
        ne(plots.id, plotId),
        lte(plots.minLon, maxLon),
        gte(plots.maxLon, minLon),
        lte(plots.minLat, maxLat),
        gte(plots.maxLat, minLat),
      ),
    );
  const candidates = near.filter((p) => p.geometry).map((p) => ({ id: p.id, geometry: p.geometry! }));
  return findOverlaps([{ id: plotId, geometry }, ...candidates])
    .filter((o) => o.a === plotId || o.b === plotId)
    .map((o) => ({ plotRef: near.find((n) => n.id === (o.a === plotId ? o.b : o.a))!.ref, overlapHa: o.overlapHa }));
}

/**
 * Replaces a plot's geometry with one captured in the field. The rules re-validate it and
 * re-check overlaps; field requests close only when the new shape is valid and overlaps nothing.
 */
export async function recapturePlot(
  db: Db,
  input: { orgId: string; plotId: string; geometry: PlotGeometry; source: "telegram_location" | "mini_app_walk"; fieldAgentId: string },
) {
  const [plot] = await db.select().from(plots).where(and(eq(plots.id, input.plotId), eq(plots.orgId, input.orgId)));
  if (!plot) throw new Error(`Plot ${input.plotId} not found`);

  const v = validatePlot(input.geometry, { declaredAreaHa: plot.declaredAreaHa ?? undefined });
  const stored = v.geometry ?? input.geometry;
  const [minLon, minLat, maxLon, maxLat] = bbox(stored);
  await db
    .update(plots)
    .set({
      geometry: stored,
      issues: v.issues,
      areaHa: v.areaHa,
      status: "not_checked",
      statusReasons: [v.ok ? "awaiting_screening" : "invalid_geometry"],
      reviewAccepted: false,
      reviewReason: null,
      minLon,
      minLat,
      maxLon,
      maxLat,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(plots.id, plot.id));

  const overlaps = v.ok ? await overlapsWith(db, input.orgId, plot.id, stored) : [];
  if (v.ok) {
    const now = new Date().toISOString();
    if (overlaps.length) {
      // The shape is fixed but still claims a neighbour's land: close the other requests, keep one for the overlap.
      await db
        .update(gaps)
        .set({ status: "resolved", resolvedAt: now })
        .where(and(eq(gaps.plotId, plot.id), eq(gaps.status, "open"), inArray(gaps.need, [...FIELD_GEOMETRY_NEEDS]), ne(gaps.reason, "overlap")));
      const [openOverlap] = await db
        .select({ id: gaps.id })
        .from(gaps)
        .where(and(eq(gaps.plotId, plot.id), eq(gaps.status, "open"), eq(gaps.reason, "overlap")));
      if (!openOverlap && plot.fieldAgentId) {
        await db.insert(gaps).values({ orgId: input.orgId, plotId: plot.id, fieldAgentId: plot.fieldAgentId, need: "boundary", reason: "overlap" });
      }
    } else {
      await db
        .update(gaps)
        .set({ status: "resolved", resolvedAt: now })
        .where(and(eq(gaps.plotId, plot.id), eq(gaps.status, "open"), inArray(gaps.need, [...FIELD_GEOMETRY_NEEDS])));
    }
  }

  await recordEvent(db, {
    orgId: input.orgId,
    type: "plot.recaptured",
    payload: {
      plotRef: plot.ref,
      source: input.source,
      fieldAgentId: input.fieldAgentId,
      valid: v.ok,
      issues: v.issues.map((i) => i.code),
      areaHa: v.areaHa,
      overlaps,
    },
  });
  return { plot, validation: v, overlaps };
}

/** A person accepts a review plot with a reason. Its photo requests close; the lot is re-evaluated. */
export async function acceptReviewPlot(db: Db, input: { orgId: string; plotRef: string; reason: string }) {
  const [plot] = await db.select().from(plots).where(and(eq(plots.orgId, input.orgId), eq(plots.ref, input.plotRef)));
  if (!plot || plot.status !== "review") return { ok: false as const, message: "Only a plot that needs review can be accepted." };
  await db.update(plots).set({ reviewAccepted: true, reviewReason: input.reason }).where(eq(plots.id, plot.id));
  await db
    .update(gaps)
    .set({ status: "resolved", resolvedAt: new Date().toISOString() })
    .where(and(eq(gaps.plotId, plot.id), eq(gaps.status, "open"), eq(gaps.need, "photo")));
  await recordEvent(db, { orgId: input.orgId, type: "review.accepted", payload: { plotRef: plot.ref, reason: input.reason, by: "exporter" } });
  const lotIds = (await db.select({ lotId: lotPlots.lotId }).from(lotPlots).where(eq(lotPlots.plotId, plot.id))).map((r) => r.lotId);
  await refreshLotsByIds(db, input.orgId, lotIds);
  return { ok: true as const, message: `${plot.ref} accepted. The reason is on the ledger.` };
}

/**
 * The exporter takes a plot out of its lot, the simplest form of splitting a lot.
 * Its coffee no longer ships in that lot; the decision and reason go on the ledger.
 */
export async function removePlotFromLot(db: Db, input: { orgId: string; plotRef: string; reason: string }) {
  const [row] = await db
    .select({ plotId: plots.id, lotId: lots.id, lotRef: lots.ref })
    .from(lotPlots)
    .innerJoin(plots, eq(plots.id, lotPlots.plotId))
    .innerJoin(lots, eq(lots.id, lotPlots.lotId))
    .where(and(eq(plots.orgId, input.orgId), eq(plots.ref, input.plotRef)));
  if (!row) return { ok: false as const, message: "This plot is not in a lot." };
  await db.delete(lotPlots).where(and(eq(lotPlots.lotId, row.lotId), eq(lotPlots.plotId, row.plotId)));
  const [{ remaining }] = await db.select({ remaining: sql<number>`count(*)::int` }).from(lotPlots).where(eq(lotPlots.lotId, row.lotId));
  await recordEvent(db, {
    orgId: input.orgId,
    type: "lot.plot_removed",
    payload: { plotRef: input.plotRef, lotRef: row.lotRef, reason: input.reason, remainingPlots: remaining, by: "exporter" },
  });
  await refreshLotsByIds(db, input.orgId, [row.lotId]);
  return { ok: true as const, message: `${input.plotRef} removed from ${row.lotRef}. The reason is on the ledger.` };
}
