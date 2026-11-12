/**
 * Chain of custody and volume checks. Coffee moves from plot to collector, washing
 * station, lot and shipment. A delivery larger than its source plots could plausibly
 * grow suggests coffee from unmapped farms, which the EUDR cannot accept.
 */
import { YIELD_KG_PER_HA, YIELD_TOLERANCE } from "@/config/policy";

export type CustodyPlot = { id: string; ref: string; farmerId: string; areaHa: number | null; declaredAreaHa: number | null };
export type CustodyDelivery = { farmerId: string; plotId: string | null; siteId: string; lotId: string; kg: number };

/** The most green coffee a plot can plausibly produce in a season. */
export function plausibleKg(areaHa: number, region = "default"): number {
  return Math.round(areaHa * (YIELD_KG_PER_HA[region] ?? YIELD_KG_PER_HA.default) * YIELD_TOLERANCE);
}

const area = (p: CustodyPlot) => p.areaHa ?? p.declaredAreaHa ?? 0;

export type VolumeFinding =
  | { kind: "volume_farmer"; subjectId: string; deliveredKg: number; plausibleKg: number; areaHa: number; plotRefs: string[] }
  | { kind: "unmapped_supplier"; subjectId: string; deliveredKg: number }
  | { kind: "volume_lot"; subjectId: string; deliveredKg: number; plausibleKg: number; areaHa: number };

/**
 * Checks one lot. A farmer is flagged when their deliveries into the lot exceed what all
 * their plots could grow; a delivery from a farmer with no mapped plot is flagged; and the
 * lot is flagged when its total exceeds what all its plots could grow.
 */
export function checkLotVolumes(input: { lotId: string; deliveries: CustodyDelivery[]; plots: CustodyPlot[] }): VolumeFinding[] {
  const findings: VolumeFinding[] = [];
  const inLot = input.deliveries.filter((d) => d.lotId === input.lotId);
  const byFarmer = new Map<string, number>();
  for (const d of inLot) byFarmer.set(d.farmerId, (byFarmer.get(d.farmerId) ?? 0) + d.kg);

  for (const [farmerId, kg] of byFarmer) {
    const own = input.plots.filter((p) => p.farmerId === farmerId);
    if (!own.length) {
      findings.push({ kind: "unmapped_supplier", subjectId: farmerId, deliveredKg: kg });
      continue;
    }
    const ha = own.reduce((s, p) => s + area(p), 0);
    const max = plausibleKg(ha);
    if (kg > max) findings.push({ kind: "volume_farmer", subjectId: farmerId, deliveredKg: kg, plausibleKg: max, areaHa: round2(ha), plotRefs: own.map((p) => p.ref) });
  }

  const sourcePlotIds = new Set(inLot.map((d) => d.plotId).filter(Boolean));
  const sourceHa = input.plots.filter((p) => sourcePlotIds.has(p.id)).reduce((s, p) => s + area(p), 0);
  const total = inLot.reduce((s, d) => s + d.kg, 0);
  const lotMax = plausibleKg(sourceHa);
  if (total > lotMax) findings.push({ kind: "volume_lot", subjectId: input.lotId, deliveredKg: total, plausibleKg: lotMax, areaHa: round2(sourceHa) });
  return findings;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type GraphNode = { id: string; kind: "plot" | "collector" | "washing_station" | "lot" | "shipment"; label: string; sub?: string; flagged?: boolean };
export type GraphEdge = { from: string; to: string; kg: number };

/** The custody graph for one lot: plots, then sites, then the lot and its shipment, with kilograms on each edge. */
export function buildCustodyGraph(input: {
  lot: { id: string; ref: string };
  shipment: { id: string; ref: string } | null;
  deliveries: CustodyDelivery[];
  plots: CustodyPlot[];
  sites: { id: string; kind: "collector" | "washing_station"; name: string; parentId: string | null }[];
  flaggedFarmers: Set<string>;
}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const addEdge = (from: string, to: string, kg: number) => {
    const key = `${from}>${to}`;
    const e = edges.get(key);
    if (e) e.kg += kg;
    else edges.set(key, { from, to, kg });
  };
  const siteById = new Map(input.sites.map((s) => [s.id, s]));
  const plotById = new Map(input.plots.map((p) => [p.id, p]));

  nodes.set(input.lot.id, { id: input.lot.id, kind: "lot", label: input.lot.ref });
  if (input.shipment) nodes.set(input.shipment.id, { id: input.shipment.id, kind: "shipment", label: input.shipment.ref });

  for (const d of input.deliveries.filter((x) => x.lotId === input.lot.id)) {
    const plot = d.plotId ? plotById.get(d.plotId) : undefined;
    const source = plot ? plot.id : `unmapped:${d.farmerId}`;
    if (!nodes.has(source))
      nodes.set(source, plot
        ? { id: source, kind: "plot", label: plot.ref, sub: `${round2(area(plot))} ha`, flagged: input.flaggedFarmers.has(d.farmerId) }
        : { id: source, kind: "plot", label: "Unmapped farm", sub: "no plot on record", flagged: true });

    // Walk up from the receiving site to the washing station.
    let site = siteById.get(d.siteId);
    let from = source;
    while (site) {
      if (!nodes.has(site.id)) nodes.set(site.id, { id: site.id, kind: site.kind, label: site.name });
      addEdge(from, site.id, d.kg);
      from = site.id;
      site = site.parentId ? siteById.get(site.parentId) : undefined;
    }
    addEdge(from, input.lot.id, d.kg);
  }
  if (input.shipment) {
    const total = [...edges.values()].filter((e) => e.to === input.lot.id).reduce((s, e) => s + e.kg, 0);
    addEdge(input.lot.id, input.shipment.id, total);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
