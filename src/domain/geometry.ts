/**
 * Plot geometry rules from the EUDR and the EU information system's GeoJSON
 * specification. Pure functions: no I/O, no clock.
 */
import { area, bbox, circle, featureCollection, intersect, kinks, polygon } from "@turf/turf";
import {
  AREA_MISMATCH_FRACTION,
  ETHIOPIA_BBOX,
  POINT_DEFAULT_HA,
  POLYGON_REQUIRED_ABOVE_HA,
} from "@/config/policy";
import type { AreaGeometry, Issue, IssueCode, PlotGeometry, Polygon, Position } from "./types";

/** Below this a ring is floating-point residue, not land: one square metre. */
const MIN_RING_AREA_M2 = 1;

const issue = (code: IssueCode, severity: Issue["severity"], message: string): Issue => ({ code, severity, message });

/** The EU system truncates to 6 decimals; we do the same so validation sees what the EU will see. */
export function truncate6(n: number): number {
  return Math.trunc(n * 1e6) / 1e6;
}

const mapPositions = (g: PlotGeometry, f: (p: Position) => Position): PlotGeometry => {
  switch (g.type) {
    case "Point":
      return { type: "Point", coordinates: f(g.coordinates) };
    case "Polygon":
      return { type: "Polygon", coordinates: g.coordinates.map((r) => r.map(f)) };
    case "MultiPolygon":
      return { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map((r) => r.map(f))) };
  }
};

export function truncateGeometry(g: PlotGeometry): PlotGeometry {
  return mapPositions(g, ([x, y]) => [truncate6(x), truncate6(y)]);
}

const allPositions = (g: PlotGeometry): Position[] =>
  g.type === "Point" ? [g.coordinates] : g.type === "Polygon" ? g.coordinates.flat() : g.coordinates.flat(2);

const polygonsOf = (g: PlotGeometry): Position[][][] =>
  g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];

const inEthiopia = (lon: number, lat: number) =>
  lat >= ETHIOPIA_BBOX.minLat && lat <= ETHIOPIA_BBOX.maxLat && lon >= ETHIOPIA_BBOX.minLon && lon <= ETHIOPIA_BBOX.maxLon;

const samePos = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

const decimals = (n: number) => {
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 || s.includes("e") ? 0 : s.length - i - 1;
};

function dedupeConsecutive(ring: Position[]): Position[] {
  return ring.filter((p, i) => i === 0 || !samePos(p, ring[i - 1]));
}

function distinctCount(ring: Position[]): number {
  return new Set(ring.map((p) => `${p[0]},${p[1]}`)).size;
}

function isSwapped(g: PlotGeometry): boolean {
  const ps = allPositions(g);
  return !ps.every(([x, y]) => inEthiopia(x, y)) && ps.every(([x, y]) => inEthiopia(y, x));
}

function asGeometry(input: unknown): unknown {
  if (input && typeof input === "object" && (input as { type?: string }).type === "Feature") {
    return (input as { geometry?: unknown }).geometry;
  }
  return input;
}

function isFinitePosition(p: unknown): p is Position {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function hasValidShape(g: { type: string; coordinates?: unknown }): g is PlotGeometry {
  const c = g.coordinates;
  if (g.type === "Point") return isFinitePosition(c);
  const ring = (r: unknown) => Array.isArray(r) && r.length > 0 && r.every(isFinitePosition);
  const poly = (p: unknown) => Array.isArray(p) && p.length > 0 && p.every(ring);
  if (g.type === "Polygon") return poly(c);
  if (g.type === "MultiPolygon") return Array.isArray(c) && c.length > 0 && c.every(poly);
  return false;
}

export function areaHa(g: PlotGeometry, declaredPointAreaHa?: number): number {
  if (g.type === "Point") return declaredPointAreaHa ?? POINT_DEFAULT_HA;
  return area(g) / 10_000;
}

export type ValidationResult = {
  ok: boolean;
  issues: Issue[];
  /** The truncated geometry when the structure is sound, else the input as given. */
  geometry: PlotGeometry | null;
  areaHa: number | null;
};

export function validatePlot(input: unknown, opts: { declaredAreaHa?: number } = {}): ValidationResult {
  const raw = asGeometry(input) as { type?: string; coordinates?: unknown } | null | undefined;
  if (!raw || typeof raw !== "object" || raw.coordinates === undefined) {
    return { ok: false, issues: [issue("missing_geometry", "error", "No geometry was provided.")], geometry: null, areaHa: null };
  }
  if (!["Point", "Polygon", "MultiPolygon"].includes(raw.type ?? "") || !hasValidShape(raw as { type: string })) {
    return {
      ok: false,
      issues: [issue("invalid_type", "error", `Unsupported or malformed geometry type "${raw.type}". Use Point, Polygon or MultiPolygon.`)],
      geometry: null,
      areaHa: null,
    };
  }
  const g = raw as PlotGeometry;
  const issues: Issue[] = [];

  if (isSwapped(g)) {
    issues.push(issue("swapped_coordinates", "error", "Latitude and longitude appear to be swapped."));
    return { ok: false, issues, geometry: g, areaHa: null };
  }
  if (!allPositions(g).every(([x, y]) => inEthiopia(x, y))) {
    issues.push(issue("out_of_bounds", "error", "Coordinates fall outside Ethiopia."));
  }
  if (allPositions(g).some(([x, y]) => decimals(x) < 6 || decimals(y) < 6)) {
    issues.push(issue("low_precision", "warning", "Some coordinates have fewer than 6 decimal places."));
  }

  if (g.type === "Point") {
    if ((opts.declaredAreaHa ?? 0) > POLYGON_REQUIRED_ABOVE_HA) {
      issues.push(issue("polygon_required", "error", `Plots above ${POLYGON_REQUIRED_ABOVE_HA} ha need a boundary polygon.`));
    }
    const ok = !issues.some((i) => i.severity === "error");
    return { ok, issues, geometry: truncateGeometry(g), areaHa: areaHa(g, opts.declaredAreaHa) };
  }

  let structural = true;
  for (const rings of polygonsOf(g)) {
    if (rings.length > 1) issues.push(issue("has_holes", "error", "Polygons with holes are not accepted by the EU system."));
    for (const ring of rings) {
      if (!samePos(ring[0], ring.at(-1)!)) {
        issues.push(issue("ring_not_closed", "error", "The boundary does not end where it starts."));
        structural = false;
      } else if (distinctCount(ring) < 3) {
        issues.push(issue("too_few_vertices", "error", "A boundary needs at least three distinct corners."));
        structural = false;
      }
      if (dedupeConsecutive(ring).length !== ring.length) {
        issues.push(issue("duplicate_vertices", "warning", "The boundary repeats a corner."));
      }
    }
  }
  if (!structural) return { ok: false, issues: dedupeIssues(issues), geometry: g, areaHa: null };

  const truncated = truncateGeometry(g);
  // Each polygon is checked on its own: parts of a MultiPolygon may share an edge.
  const parts = polygonsOf(truncated);
  const crosses = parts.some(
    (rings) => rings.every((r) => distinctCount(r) >= 3) && kinks(polygon(rings.map(dedupeConsecutive))).features.length > 0,
  );
  const collapsed =
    !crosses &&
    parts.some((rings) => rings.some((r) => distinctCount(r) < 3 || area(polygon([dedupeConsecutive(r)])) < MIN_RING_AREA_M2));
  if (collapsed) {
    issues.push(issue("degenerate_after_truncation", "error", "The shape collapses at 6 decimal places, the EU system's precision."));
    return { ok: false, issues: dedupeIssues(issues), geometry: g, areaHa: null };
  }
  if (crosses) {
    issues.push(issue("self_intersection", "error", "The boundary crosses itself."));
  }

  const mapped = areaHa(truncated);
  if (opts.declaredAreaHa && Math.abs(mapped - opts.declaredAreaHa) / opts.declaredAreaHa > AREA_MISMATCH_FRACTION) {
    issues.push(
      issue("area_mismatch", "warning", `Mapped area ${mapped.toFixed(2)} ha differs from the declared ${opts.declaredAreaHa} ha.`),
    );
  }
  const finalIssues = dedupeIssues(issues);
  return { ok: !finalIssues.some((i) => i.severity === "error"), issues: finalIssues, geometry: truncated, areaHa: mapped };
}

function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<IssueCode>();
  return issues.filter((i) => (seen.has(i.code) ? false : (seen.add(i.code), true)));
}

export type RepairCode = "closed_ring" | "removed_duplicate_vertices" | "split_holes" | "swapped_coordinates";

/**
 * Safe repairs. `changesShape` is true when the plot's location or footprint moves,
 * which the autonomy rules treat as needing a person's approval.
 */
export function repairPlot(input: PlotGeometry): { geometry: PlotGeometry; applied: RepairCode[]; changesShape: boolean } {
  const applied = new Set<RepairCode>();
  let g = input;
  let changesShape = false;

  if (isSwapped(g)) {
    g = mapPositions(g, ([x, y]) => [y, x]);
    applied.add("swapped_coordinates");
    changesShape = true;
  }
  if (g.type === "Point") return { geometry: g, applied: [...applied], changesShape };

  const fixed = polygonsOf(g).map((rings) =>
    rings.map((ring) => {
      let r = dedupeConsecutive(ring);
      if (r.length !== ring.length) applied.add("removed_duplicate_vertices");
      if (!samePos(r[0], r.at(-1)!)) {
        r = [...r, r[0]];
        applied.add("closed_ring");
      }
      return r;
    }),
  );

  const parts = fixed.flatMap((rings) => {
    if (rings.length === 1) return [rings];
    applied.add("split_holes");
    return splitHoles(rings);
  });

  const geometry: PlotGeometry =
    parts.length === 1 ? { type: "Polygon", coordinates: parts[0] } : { type: "MultiPolygon", coordinates: parts };
  return { geometry, applied: [...applied], changesShape };
}

/**
 * Removes holes by cutting the polygon along a vertical line through each hole,
 * the approach the EU documentation suggests ("split a doughnut into two halves").
 * The footprint, and so the area, is unchanged.
 */
function splitHoles(rings: Position[][], depth = 0): Position[][][] {
  if (rings.length === 1 || depth > 32) return [rings];
  const hole = rings[1].slice(0, -1);
  const cx = hole.reduce((s, p) => s + p[0], 0) / hole.length;
  const [minX, minY, maxX, maxY] = bbox(polygon(rings));
  const pad = 1;
  const half = (x0: number, x1: number) =>
    polygon([[[x0, minY - pad], [x1, minY - pad], [x1, maxY + pad], [x0, maxY + pad], [x0, minY - pad]]]);
  return [half(minX - pad, cx), half(cx, maxX + pad)].flatMap((cut) => {
    const res = intersect(featureCollection([polygon(rings), cut]));
    if (!res) return [];
    const pieces = res.geometry.type === "Polygon" ? [res.geometry.coordinates] : res.geometry.coordinates;
    return pieces.flatMap((p) => splitHoles(p, depth + 1));
  });
}

/** The area to screen against satellite data. A point stands for a circle of its declared area. */
export function screeningGeometry(g: PlotGeometry, declaredAreaHa?: number): AreaGeometry {
  if (g.type !== "Point") return g;
  const ha = declaredAreaHa ?? POINT_DEFAULT_HA;
  const radiusKm = Math.sqrt((ha * 10_000) / Math.PI) / 1000;
  return circle(g.coordinates, radiusKm, { steps: 64, units: "kilometers" }).geometry as Polygon;
}

/** Pairs of polygon plots that overlap by at least `minHa`. Points are ignored. */
export function findOverlaps(
  plots: { id: string; geometry: PlotGeometry }[],
  minHa = 0.01,
): { a: string; b: string; overlapHa: number }[] {
  const shapes = plots
    .filter((p) => p.geometry.type !== "Point")
    .map((p) => ({ id: p.id, g: p.geometry as AreaGeometry, box: bbox(p.geometry) }));
  const hits: { a: string; b: string; overlapHa: number }[] = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const [a, b] = [shapes[i], shapes[j]];
      if (a.box[2] < b.box[0] || b.box[2] < a.box[0] || a.box[3] < b.box[1] || b.box[3] < a.box[1]) continue;
      const res = intersect(featureCollection([{ type: "Feature", properties: {}, geometry: a.g }, { type: "Feature", properties: {}, geometry: b.g }]));
      if (!res) continue;
      const overlapHa = area(res) / 10_000;
      if (overlapHa >= minHa) hits.push({ a: a.id, b: b.id, overlapHa });
    }
  }
  return hits;
}
