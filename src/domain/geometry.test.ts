import { describe, expect, it } from "vitest";
import type { Polygon, Position } from "geojson";
import { areaHa, findOverlaps, repairPlot, screeningGeometry, truncate6, validatePlot } from "./geometry";

// Near Yirgacheffe, Ethiopia.
const LON = 38.2;
const LAT = 6.16;
const degLat = (m: number) => m / 111_320;
const degLon = (m: number) => m / (111_320 * Math.cos((LAT * Math.PI) / 180));

/** Closed square ring with side `sideM` metres, south-west corner offset by (dxM, dyM). */
function square(sideM: number, dxM = 0, dyM = 0): Position[] {
  const x0 = LON + degLon(dxM);
  const y0 = LAT + degLat(dyM);
  const x1 = x0 + degLon(sideM);
  const y1 = y0 + degLat(sideM);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}
const poly = (...rings: Position[][]): Polygon => ({ type: "Polygon", coordinates: rings });
const codes = (r: ReturnType<typeof validatePlot>) => r.issues.map((i) => i.code);

describe("truncate6", () => {
  it("truncates instead of rounding, for both signs", () => {
    expect(truncate6(38.1234569)).toBe(38.123456);
    expect(truncate6(-1.9999999)).toBe(-1.999999);
  });
});

describe("validatePlot", () => {
  it("accepts a valid 2 ha square and reports its area", () => {
    const r = validatePlot(poly(square(Math.sqrt(20_000))));
    expect(r.ok).toBe(true);
    expect(r.areaHa).toBeCloseTo(2, 1);
  });

  it("accepts a GeoJSON Feature as input", () => {
    const r = validatePlot({ type: "Feature", properties: {}, geometry: poly(square(100)) });
    expect(r.ok).toBe(true);
  });

  it("requires a polygon for a point declared above 4 ha", () => {
    const r = validatePlot({ type: "Point", coordinates: [38.201234, 6.161234] }, { declaredAreaHa: 6 });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("polygon_required");
  });

  it("accepts a point for a plot of 4 ha or less", () => {
    const r = validatePlot({ type: "Point", coordinates: [38.201234, 6.161234] }, { declaredAreaHa: 4 });
    expect(r.ok).toBe(true);
    expect(r.areaHa).toBe(4);
  });

  it("flags swapped latitude and longitude", () => {
    const r = validatePlot({ type: "Point", coordinates: [6.161234, 38.201234] });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("swapped_coordinates");
  });

  it("flags a location outside Ethiopia", () => {
    expect(codes(validatePlot({ type: "Point", coordinates: [2.352222, 48.856613] }))).toContain("out_of_bounds");
  });

  it("warns on low precision without failing", () => {
    const r = validatePlot({ type: "Point", coordinates: [38.2, 6.16] });
    expect(r.ok).toBe(true);
    expect(r.issues.find((i) => i.code === "low_precision")?.severity).toBe("warning");
  });

  it("flags an unclosed ring", () => {
    const ring = square(100).slice(0, 4);
    expect(codes(validatePlot(poly(ring)))).toContain("ring_not_closed");
  });

  it("flags a ring with too few vertices", () => {
    const [a, b] = square(100);
    expect(codes(validatePlot(poly([a, b, a])))).toContain("too_few_vertices");
  });

  it("flags a figure-eight as self-intersecting", () => {
    const [a, b, c, d] = square(100);
    expect(codes(validatePlot(poly([a, c, b, d, a])))).toContain("self_intersection");
  });

  it("flags holes", () => {
    const outer = square(200);
    const hole = square(50, 75, 75).reverse();
    expect(codes(validatePlot(poly(outer, hole)))).toContain("has_holes");
  });

  it("flags a shape that collapses after 6-decimal truncation", () => {
    const r = validatePlot(poly([[38.2000001, 6.16], [38.2000004, 6.16], [38.2000002, 6.1600003], [38.2000001, 6.16]]));
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("degenerate_after_truncation");
  });

  it("warns when the declared area differs from the mapped area by more than 20%", () => {
    const r = validatePlot(poly(square(100)), { declaredAreaHa: 2 });
    expect(r.issues.find((i) => i.code === "area_mismatch")?.severity).toBe("warning");
  });

  it("rejects missing and unsupported geometry", () => {
    expect(codes(validatePlot(null))).toContain("missing_geometry");
    expect(codes(validatePlot({ type: "LineString", coordinates: [[38.2, 6.16], [38.3, 6.17]] }))).toContain("invalid_type");
  });
});

describe("repairPlot", () => {
  it("closes a ring without changing the shape", () => {
    const r = repairPlot(poly(square(100).slice(0, 4)));
    expect(r.applied).toContain("closed_ring");
    expect(r.changesShape).toBe(false);
    expect(validatePlot(r.geometry).ok).toBe(true);
  });

  it("splits a holed polygon into hole-free parts with the same area", () => {
    const g = poly(square(200), square(50, 75, 75).reverse());
    const r = repairPlot(g);
    expect(r.applied).toContain("split_holes");
    expect(r.changesShape).toBe(false);
    expect(r.geometry.type).toBe("MultiPolygon");
    if (r.geometry.type === "MultiPolygon") {
      expect(r.geometry.coordinates.every((p) => p.length === 1)).toBe(true);
    }
    expect(areaHa(r.geometry)).toBeCloseTo(areaHa(g), 2);
    expect(validatePlot(r.geometry).ok).toBe(true);
  });

  it("swaps coordinates, and marks that as a shape change needing approval", () => {
    const r = repairPlot({ type: "Point", coordinates: [6.161234, 38.201234] });
    expect(r.geometry).toEqual({ type: "Point", coordinates: [38.201234, 6.161234] });
    expect(r.changesShape).toBe(true);
  });

  it("removes consecutive duplicate vertices", () => {
    const [a, b, c, d] = square(100);
    const r = repairPlot(poly([a, b, b, c, d, a]));
    expect(r.applied).toContain("removed_duplicate_vertices");
    expect((r.geometry as Polygon).coordinates[0]).toHaveLength(5);
  });
});

describe("screeningGeometry", () => {
  it("turns a point into a circle of the declared area", () => {
    const g = screeningGeometry({ type: "Point", coordinates: [38.201234, 6.161234] }, 2);
    expect(areaHa(g)).toBeCloseTo(2, 1);
  });

  it("uses the EU default of 4 ha when no area is declared", () => {
    expect(areaHa(screeningGeometry({ type: "Point", coordinates: [38.201234, 6.161234] }))).toBeCloseTo(4, 1);
  });
});

describe("findOverlaps", () => {
  it("finds two plots overlapping by half a hectare", () => {
    const hits = findOverlaps([
      { id: "a", geometry: poly(square(100)) },
      { id: "b", geometry: poly(square(100, 50, 0)) },
      { id: "c", geometry: poly(square(100, 1000, 1000)) },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ a: "a", b: "b" });
    expect(hits[0].overlapHa).toBeCloseTo(0.5, 1);
  });
});
