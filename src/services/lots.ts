import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { gaps, lotPlots, lots, plots } from "@/db/schema";
import { evaluateLot } from "@/domain/lots";

/** Re-evaluates the lots that contain any of the given plots, and records every change of state. */
export async function refreshLots(db: Db, orgId: string, plotIds: string[]): Promise<void> {
  if (!plotIds.length) return;
  const affected = await db.selectDistinct({ lotId: lotPlots.lotId }).from(lotPlots).where(inArray(lotPlots.plotId, plotIds));
  await refreshLotsByIds(db, orgId, affected.map((a) => a.lotId));
}

export async function refreshLotsByIds(db: Db, orgId: string, lotIds: string[]): Promise<void> {
  for (const lotId of lotIds) {
    const [lot] = await db.select().from(lots).where(and(eq(lots.id, lotId), eq(lots.orgId, orgId)));
    if (!lot) continue;
    const rows = await db
      .select({
        id: plots.id,
        ref: plots.ref,
        status: plots.status,
        reviewAccepted: plots.reviewAccepted,
        openRequests: sql<number>`(select count(*)::int from ${gaps} where ${gaps.plotId} = ${plots.id} and ${gaps.status} = 'open')`,
      })
      .from(lotPlots)
      .innerJoin(plots, eq(plots.id, lotPlots.plotId))
      .where(eq(lotPlots.lotId, lotId));
    const result = evaluateLot(rows);
    if (result.state !== lot.state) {
      await db.update(lots).set({ state: result.state }).where(eq(lots.id, lotId));
      await recordEvent(db, {
        orgId,
        type: result.state === "ready" ? "lot.ready" : "lot.held",
        payload: { lotRef: lot.ref, heldBy: rows.filter((r) => result.heldBy.includes(r.id)).map((r) => r.ref) },
      });
    }
  }
}
