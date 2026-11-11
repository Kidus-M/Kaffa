import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadChain } from "@/db/events";
import { farmers, lotPlots, lots, plots, shipments } from "@/db/schema";
import { buildDdsDataSheet, toEuGeoJson } from "@/domain/eu-export";
import type { PlotStatus } from "@/domain/types";

/** A lot's EU-format files, if the portal token belongs to the lot's shipment. */
export async function exportLot(db: Db, input: { lotRef: string; token: string; now?: Date }) {
  const [row] = await db
    .select({ lot: lots, shipment: shipments })
    .from(lots)
    .innerJoin(shipments, eq(shipments.id, lots.shipmentId))
    .where(and(eq(lots.ref, input.lotRef), eq(shipments.portalToken, input.token)));
  if (!row) return null;
  if (row.lot.state !== "ready") return { ready: false as const, lot: row.lot, reason: "held" as const };

  const members = await db
    .select({ plot: plots, farmer: farmers })
    .from(lotPlots)
    .innerJoin(plots, eq(plots.id, lotPlots.plotId))
    .innerJoin(farmers, eq(farmers.id, plots.farmerId))
    .where(eq(lotPlots.lotId, row.lot.id));

  const { files, rejected } = toEuGeoJson(
    members
      .filter((m) => m.plot.geometry)
      .map((m) => ({
        id: m.plot.ref,
        geometry: m.plot.geometry!,
        productionPlace: `${m.plot.ref}, ${m.farmer.village ?? ""}`.trim(),
        producerName: m.farmer.nameLatin ?? undefined,
        areaHa: m.plot.areaHa ?? m.plot.declaredAreaHa ?? 4,
      })),
  );
  const summary: Record<PlotStatus, number> = { clear: 0, review: 0, blocked: 0, not_checked: 0 };
  for (const m of members) summary[m.plot.status]++;
  const { verification } = await loadChain(db, row.lot.orgId);
  const fileNames = files.map((_, i) => `${row.lot.ref}-plots-${i + 1}.geojson`);
  const sheet = buildDdsDataSheet({
    lotId: row.lot.ref,
    description: `${row.lot.grade}, synthetic demo lot`,
    quantityKg: row.lot.quantityKg,
    plotsFileNames: fileNames,
    ledgerHead: verification.ok ? verification.head : "ledger-broken",
    statusSummary: summary,
    generatedAt: (input.now ?? new Date()).toISOString(),
  });
  // A partial file would let a buyer file a statement with plots missing: all or nothing.
  if (rejected.length || members.some((m) => !m.plot.geometry)) return { ready: false as const, lot: row.lot, reason: "incomplete" as const };
  return { ready: true as const, lot: row.lot, files, fileNames, rejected, sheet };
}
