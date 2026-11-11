import { and, eq, inArray } from "drizzle-orm";
import { bbox } from "@turf/turf";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { gaps, plots } from "@/db/schema";
import { validatePlot } from "@/domain/geometry";
import type { PlotGeometry } from "@/domain/types";

const FIELD_GEOMETRY_NEEDS = ["boundary", "location", "confirm"] as const;

/**
 * Replaces a plot's geometry with one captured in the field. The rules re-validate it;
 * if it passes, the field requests it answers are closed and the plot waits for screening.
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

  if (v.ok) {
    await db
      .update(gaps)
      .set({ status: "resolved", resolvedAt: new Date().toISOString() })
      .where(and(eq(gaps.plotId, plot.id), eq(gaps.status, "open"), inArray(gaps.need, [...FIELD_GEOMETRY_NEEDS])));
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
    },
  });
  return { plot, validation: v };
}
