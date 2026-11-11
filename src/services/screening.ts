/**
 * Geo analyst: screens one plot against every satellite source, then lets the rules
 * decide its status. Each step is traced and each outcome goes on the ledger.
 */
import { and, eq } from "drizzle-orm";
import { CUTOFF_DATE } from "@/config/policy";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { checks, gaps, plots } from "@/db/schema";
import { gapsForPlot } from "@/domain/gaps";
import { screeningGeometry } from "@/domain/geometry";
import { evaluatePlot } from "@/domain/status";
import type { PlotStatus } from "@/domain/types";
import type { GfwClient } from "@/integrations/gfw";
import { refreshLots } from "./lots";
import { startTrace, timed } from "./trace";

export type ScreenDeps = { db: Db; gfw: GfwClient };

/** Day after the cut-off: alerts from this date count as post-2020. */
const ALERTS_SINCE = "2021-01-01";

export async function screenPlot(
  deps: ScreenDeps,
  input: { orgId: string; plotId: string; trigger?: string },
): Promise<{ status: PlotStatus; plotRef: string }> {
  const { db, gfw } = deps;
  const [plot] = await db.select().from(plots).where(and(eq(plots.id, input.plotId), eq(plots.orgId, input.orgId)));
  if (!plot) throw new Error(`Plot ${input.plotId} not found`);

  const trace = await startTrace(db, { orgId: input.orgId, agent: "geo_analyst", trigger: input.trigger ?? `screen ${plot.ref}` });
  try {
    const geometryOk = !plot.issues.some((i) => i.severity === "error") && Boolean(plot.geometry);
    let results: Awaited<ReturnType<GfwClient["treeCoverLoss"]>>[] = [];

    if (geometryOk && plot.geometry) {
      const area = screeningGeometry(plot.geometry, plot.declaredAreaHa ?? undefined);
      const [[loss, alerts], ms] = await timed(() =>
        Promise.all([gfw.treeCoverLoss(area), gfw.integratedAlerts(area, ALERTS_SINCE)]),
      );
      results = [loss, alerts];
      await trace.step("tool", "global_forest_watch", { plotRef: plot.ref, cutoff: CUTOFF_DATE, simulated: gfw.simulated }, results, ms);
    } else {
      await trace.step("note", "skipped_screening", { plotRef: plot.ref }, { reason: "invalid_geometry" });
    }

    const evaluation = evaluatePlot({ geometryOk, areaHa: plot.areaHa ?? plot.declaredAreaHa ?? 0, results });
    await trace.step("rule", "evaluate_plot", { plotRef: plot.ref, areaHa: plot.areaHa }, evaluation);

    if (results.length) {
      await db.insert(checks).values(
        results.map((r) => ({
          orgId: input.orgId,
          plotId: plot.id,
          source: r.source,
          available: r.available,
          lossHa: r.lossHa,
          alertCount: r.alertCount,
          datasetVersion: r.datasetVersion,
          rulesVersion: evaluation.rulesVersion,
          simulated: gfw.simulated,
        })),
      );
    }
    await db
      .update(plots)
      .set({
        status: evaluation.status,
        agreement: evaluation.agreement,
        statusReasons: evaluation.reasons,
        // A new status needs a new decision: an earlier review acceptance no longer applies.
        reviewAccepted: evaluation.status === plot.status ? plot.reviewAccepted : false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(plots.id, plot.id));

    if (evaluation.status === "review") {
      const existing = await db
        .select()
        .from(gaps)
        .where(and(eq(gaps.plotId, plot.id), eq(gaps.status, "open"), eq(gaps.need, "photo")));
      const spec = gapsForPlot({ issueCodes: [], status: "review", overlaps: false })[0];
      if (!existing.length && plot.fieldAgentId) {
        await db.insert(gaps).values({ orgId: input.orgId, plotId: plot.id, fieldAgentId: plot.fieldAgentId, need: spec.need, reason: spec.reason });
        await trace.step("tool", "open_field_request", { plotRef: plot.ref }, spec);
      }
    }

    await recordEvent(db, {
      orgId: input.orgId,
      type: "plot.screened",
      payload: {
        plotRef: plot.ref,
        status: evaluation.status,
        agreement: evaluation.agreement,
        reasons: evaluation.reasons,
        rulesVersion: evaluation.rulesVersion,
        simulated: gfw.simulated,
      },
    });
    await refreshLots(db, input.orgId, [plot.id]);
    await trace.finish("succeeded", `${plot.ref}: ${evaluation.status}`);
    return { status: evaluation.status, plotRef: plot.ref };
  } catch (e) {
    await trace.finish("failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}
