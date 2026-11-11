import { describe, expect, it } from "vitest";
import type { Polygon, Position } from "geojson";
import { buildDdsDataSheet, toEuGeoJson, type ExportPlot } from "./eu-export";

const LON = 38.2;
const LAT = 6.16;
const degLat = (m: number) => m / 111_320;
const degLon = (m: number) => m / (111_320 * Math.cos((LAT * Math.PI) / 180));
function square(sideM: number, dxM = 0, dyM = 0): Position[] {
  const x0 = LON + degLon(dxM), y0 = LAT + degLat(dyM), x1 = x0 + degLon(sideM), y1 = y0 + degLat(sideM);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}
const polyPlot = (id: string, rings: Position[][], areaHa = 1): ExportPlot => ({
  id,
  geometry: { type: "Polygon", coordinates: rings } as Polygon,
  productionPlace: `Plot ${id}`,
  areaHa,
});

describe("toEuGeoJson", () => {
  it("puts Area on points only, as a number, with country ET", () => {
    const { files, rejected } = toEuGeoJson([
      { id: "p1", geometry: { type: "Point", coordinates: [38.201234, 6.161234] }, productionPlace: "Konga 1", producerName: "Synthetic Farmer 1", areaHa: 2 },
      polyPlot("p2", [square(100)]),
    ]);
    expect(rejected).toEqual([]);
    const [point, poly] = files[0].features;
    expect(point.properties).toEqual({ ProducerCountry: "ET", ProductionPlace: "Konga 1", ProducerName: "Synthetic Farmer 1", Area: 2 });
    expect(poly.properties).toEqual({ ProducerCountry: "ET", ProductionPlace: "Plot p2" });
    expect(files[0].type).toBe("FeatureCollection");
  });

  it("writes no coordinate with more than 6 decimals", () => {
    const { files } = toEuGeoJson([polyPlot("p", [square(100)])]);
    const numbers = JSON.stringify(files[0].features[0].geometry).match(/-?\d+\.\d+/g)!;
    expect(numbers.every((n) => n.split(".")[1].length <= 6)).toBe(true);
  });

  it("exports a holed polygon as hole-free parts", () => {
    const { files, rejected } = toEuGeoJson([polyPlot("h", [square(200), square(50, 75, 75).reverse()], 4)]);
    expect(rejected).toEqual([]);
    const g = files[0].features[0].geometry;
    expect(g.type).toBe("MultiPolygon");
    if (g.type === "MultiPolygon") expect(g.coordinates.every((p) => p.length === 1)).toBe(true);
  });

  it("rejects a plot that collapses at 6 decimals, and a swapped one, with their issues", () => {
    const sliver: Position[] = [[38.2000001, 6.16], [38.2000004, 6.16], [38.2000002, 6.1600003], [38.2000001, 6.16]];
    const { files, rejected } = toEuGeoJson([
      polyPlot("s", [sliver]),
      { id: "w", geometry: { type: "Point", coordinates: [6.161234, 38.201234] }, productionPlace: "W", areaHa: 1 },
      polyPlot("ok", [square(100)]),
    ]);
    expect(rejected.map((r) => r.id)).toEqual(["s", "w"]);
    expect(rejected[0].issues.map((i) => i.code)).toContain("degenerate_after_truncation");
    expect(files[0].features).toHaveLength(1);
  });

  it("splits output into files under the byte limit", () => {
    const plots = Array.from({ length: 30 }, (_, i) => polyPlot(`p${i}`, [square(100, i * 300, 0)]));
    const { files } = toEuGeoJson(plots, { maxBytes: 2000 });
    expect(files.length).toBeGreaterThan(1);
    expect(files.every((f) => new TextEncoder().encode(JSON.stringify(f)).length <= 2000)).toBe(true);
    expect(files.reduce((n, f) => n + f.features.length, 0)).toBe(30);
  });
});

describe("buildDdsDataSheet", () => {
  it("summarises a lot for the buyer's due diligence statement", () => {
    const sheet = buildDdsDataSheet({
      lotId: "lot-1",
      description: "Washed Yirgacheffe Grade 1, synthetic demo lot",
      quantityKg: 19_200,
      plotsFileNames: ["lot-1-plots-1.geojson"],
      ledgerHead: "a".repeat(64),
      statusSummary: { clear: 30, review: 2, blocked: 0, not_checked: 0 },
      generatedAt: "2026-11-11T08:00:00.000Z",
    });
    expect(sheet).toMatchObject({
      countryOfProduction: "ET",
      commodity: "coffee",
      hsHeading: "0901",
      quantityKg: 19_200,
      geolocationFiles: ["lot-1-plots-1.geojson"],
      ledgerHead: "a".repeat(64),
    });
  });
});
