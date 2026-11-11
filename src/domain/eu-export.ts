/**
 * Exports plots in the format the EU information system accepts for a due
 * diligence statement, and a data sheet the buyer can file from.
 * Spec: https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html
 */
import type { Feature, FeatureCollection } from "geojson";
import { EU_MAX_GEOJSON_BYTES } from "@/config/policy";
import { repairPlot, validatePlot } from "./geometry";
import type { Issue, IssueCode, PlotGeometry, PlotStatus } from "./types";

export type ExportPlot = {
  id: string;
  geometry: PlotGeometry;
  productionPlace: string;
  producerName?: string;
  areaHa: number;
};

export type EuProperties = { ProducerCountry: "ET"; ProductionPlace: string; ProducerName?: string; Area?: number };

/** Errors a repair can fix without moving the boundary. */
const SAFE_TO_REPAIR: IssueCode[] = ["has_holes", "ring_not_closed", "duplicate_vertices"];

const byteLength = (s: string) => new TextEncoder().encode(s).length;

function prepare(plot: ExportPlot): { feature: Feature<PlotGeometry, EuProperties> } | { issues: Issue[] } {
  let result = validatePlot(plot.geometry, { declaredAreaHa: plot.areaHa });
  const errors = (r: typeof result) => r.issues.filter((i) => i.severity === "error");

  if (!result.ok && errors(result).every((i) => SAFE_TO_REPAIR.includes(i.code))) {
    const repaired = repairPlot(plot.geometry);
    if (!repaired.changesShape) result = validatePlot(repaired.geometry, { declaredAreaHa: plot.areaHa });
  }
  if (!result.ok || !result.geometry) return { issues: errors(result) };

  const properties: EuProperties = { ProducerCountry: "ET", ProductionPlace: plot.productionPlace };
  if (plot.producerName) properties.ProducerName = plot.producerName;
  if (result.geometry.type === "Point") properties.Area = plot.areaHa;
  return { feature: { type: "Feature", properties, geometry: result.geometry } };
}

export function toEuGeoJson(
  plots: ExportPlot[],
  opts: { maxBytes?: number } = {},
): { files: FeatureCollection<PlotGeometry, EuProperties>[]; rejected: { id: string; issues: Issue[] }[] } {
  const maxBytes = opts.maxBytes ?? EU_MAX_GEOJSON_BYTES;
  const rejected: { id: string; issues: Issue[] }[] = [];
  const features: Feature<PlotGeometry, EuProperties>[] = [];
  for (const plot of plots) {
    const r = prepare(plot);
    if ("issues" in r) rejected.push({ id: plot.id, issues: r.issues });
    else features.push(r.feature);
  }

  // Greedy packing into files under the byte limit. A comma separates features.
  const shell = byteLength(JSON.stringify({ type: "FeatureCollection", features: [] }));
  const files: FeatureCollection<PlotGeometry, EuProperties>[] = [];
  let current: Feature<PlotGeometry, EuProperties>[] = [];
  let size = shell;
  for (const f of features) {
    const fBytes = byteLength(JSON.stringify(f)) + (current.length ? 1 : 0);
    if (current.length && size + fBytes > maxBytes) {
      files.push({ type: "FeatureCollection", features: current });
      current = [];
      size = shell;
    }
    size += byteLength(JSON.stringify(f)) + (current.length ? 1 : 0);
    current.push(f);
  }
  if (current.length || files.length === 0) files.push({ type: "FeatureCollection", features: current });
  return { files, rejected };
}

export type DdsDataSheet = {
  schema: "kaffa.dds-data-sheet/1";
  lotId: string;
  commodity: "coffee";
  /** Annex I heading for coffee. Confirm against the current Annex before filing. */
  hsHeading: "0901";
  countryOfProduction: "ET";
  description: string;
  quantityKg: number;
  geolocationFiles: string[];
  plotStatusSummary: Record<PlotStatus, number>;
  /** Head of the tamper-evident ledger when this sheet was generated. */
  ledgerHead: string;
  generatedAt: string;
  disclaimer: string;
};

export function buildDdsDataSheet(input: {
  lotId: string;
  description: string;
  quantityKg: number;
  plotsFileNames: string[];
  ledgerHead: string;
  statusSummary: Record<PlotStatus, number>;
  generatedAt: string;
}): DdsDataSheet {
  return {
    schema: "kaffa.dds-data-sheet/1",
    lotId: input.lotId,
    commodity: "coffee",
    hsHeading: "0901",
    countryOfProduction: "ET",
    description: input.description,
    quantityKg: input.quantityKg,
    geolocationFiles: input.plotsFileNames,
    plotStatusSummary: input.statusSummary,
    ledgerHead: input.ledgerHead,
    generatedAt: input.generatedAt,
    disclaimer:
      "Supports the operator's due diligence. It is not a legal determination of compliance; the operator remains responsible for the statement.",
  };
}
