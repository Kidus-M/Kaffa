import { describe, expect, it } from "vitest";
import { walkToPolygon } from "./walk";

const LON = 38.2;
const LAT = 6.16;
const degLat = (m: number) => m / 111_320;
const degLon = (m: number) => m / (111_320 * Math.cos((LAT * Math.PI) / 180));

/** Five points per side around a square of `sideM` metres, walked anticlockwise. */
function walkSquare(sideM: number) {
  const pts: { lon: number; lat: number; accuracyM: number; t: number }[] = [];
  const corners: [number, number][] = [[0, 0], [sideM, 0], [sideM, sideM], [0, sideM]];
  corners.forEach(([x, y], i) => {
    const [nx, ny] = corners[(i + 1) % 4];
    for (let s = 0; s < 5; s++) {
      const f = s / 5;
      pts.push({ lon: LON + degLon(x + (nx - x) * f), lat: LAT + degLat(y + (ny - y) * f), accuracyM: 5, t: pts.length });
    }
  });
  return pts;
}

describe("walkToPolygon", () => {
  it("builds a polygon from a walked 1 ha square and drops an inaccurate point", () => {
    const pts = walkSquare(100);
    pts[7] = { ...pts[7], lon: pts[7].lon + degLon(80), accuracyM: 60 };
    const r = walkToPolygon(pts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dropped).toBe(1);
      expect(r.areaHa).toBeGreaterThan(0.9);
      expect(r.areaHa).toBeLessThan(1.1);
      const ring = r.polygon.coordinates[0];
      expect(ring[0]).toEqual(ring.at(-1));
    }
  });

  it("asks for a re-walk with too few points", () => {
    expect(walkToPolygon(walkSquare(100).slice(0, 3))).toEqual({ ok: false, reason: "too_few_points" });
  });

  it("asks for a re-walk when every point is inaccurate", () => {
    const pts = walkSquare(100).map((p) => ({ ...p, accuracyM: 40 }));
    expect(walkToPolygon(pts)).toEqual({ ok: false, reason: "too_few_points" });
  });

  it("accepts a walk with GPS jitter at a corner", () => {
    const pts = walkSquare(100).map((p) => ({ ...p, accuracyM: 8 }));
    const corner = pts[5];
    const jitter = [
      { ...corner, lon: corner.lon + degLon(3), t: 5.1 },
      { ...corner, lat: corner.lat - degLat(3), t: 5.2 },
      { ...corner, lon: corner.lon - degLon(2), lat: corner.lat + degLat(2), t: 5.3 },
    ];
    const r = walkToPolygon([...pts.slice(0, 6), ...jitter, ...pts.slice(6)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.areaHa).toBeGreaterThan(0.9);
  });

  it("rejects an out-and-back walk along a line as too small to be a farm", () => {
    const p = (x: number, y: number, t: number) => ({ lon: LON + degLon(x), lat: LAT + degLat(y), accuracyM: 5, t });
    const track = [p(0, 0, 0), p(50, 0, 1), p(100, 0, 2), p(100, 0.01, 3), p(50, 0.01, 4), p(0, 0.01, 5)];
    expect(walkToPolygon(track)).toEqual({ ok: false, reason: "too_small" });
  });

  it("rejects an exactly collinear walk without throwing", () => {
    const p = (x: number, t: number) => ({ lon: LON + degLon(x), lat: LAT, accuracyM: 5, t });
    expect(walkToPolygon([p(0, 0), p(30, 1), p(60, 2), p(90, 3), p(120, 4)]).ok).toBe(false);
  });

  it("rejects a track that crosses itself", () => {
    const p = (x: number, y: number, t: number) => ({ lon: LON + degLon(x), lat: LAT + degLat(y), accuracyM: 5, t });
    const figureEight = [p(0, 0, 0), p(100, 100, 1), p(100, 0, 2), p(0, 100, 3)];
    expect(walkToPolygon(figureEight)).toEqual({ ok: false, reason: "self_intersection" });
  });
});
