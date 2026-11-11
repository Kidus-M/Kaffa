/**
 * Turns a GPS track walked around a farm into a boundary polygon.
 * Runs in the Mini App (instant feedback) and again on the server (the authority).
 */
import { area, kinks, polygon, simplify } from "@turf/turf";
import { WALK_MAX_ACCURACY_M } from "@/config/policy";
import type { Polygon, Position } from "./types";

export type WalkPoint = { lon: number; lat: number; accuracyM: number; t: number };

export type WalkResult =
  | { ok: true; polygon: Polygon; areaHa: number; dropped: number }
  | { ok: false; reason: "too_few_points" | "self_intersection" | "too_small" };

const metresBetween = (a: Position, b: Position) => {
  const dy = (b[1] - a[1]) * 111_320;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

/** Below this, consecutive GPS fixes are treated as standing still. */
const MIN_STEP_M = 1;
/** A fix closer to the last kept one than its own accuracy (capped here) is GPS noise. */
const MAX_NOISE_M = 10;
/** About half a metre at Ethiopian latitudes: removes GPS jitter, keeps corners. */
const SIMPLIFY_TOLERANCE_DEG = 0.000005;
/** Smaller than this is not a farm walk but a line or a mistake: 100 square metres. */
const MIN_AREA_HA = 0.01;

export function walkToPolygon(points: WalkPoint[], opts: { maxAccuracyM?: number } = {}): WalkResult {
  const max = opts.maxAccuracyM ?? WALK_MAX_ACCURACY_M;
  const good = points.filter((p) => p.accuracyM <= max).sort((a, b) => a.t - b.t);
  const dropped = points.length - good.length;

  const track: Position[] = [];
  for (const p of good) {
    const pos: Position = [p.lon, p.lat];
    const noise = Math.max(MIN_STEP_M, Math.min(p.accuracyM, MAX_NOISE_M));
    if (!track.length || metresBetween(track.at(-1)!, pos) > noise) track.push(pos);
  }
  if (track.length < 4) return { ok: false, reason: "too_few_points" };

  // Simplify before checking for crossings, so jitter at a corner is not mistaken for one.
  let ring: Position[];
  try {
    ring = simplify(polygon([[...track, track[0]]]), { tolerance: SIMPLIFY_TOLERANCE_DEG, highQuality: true }).geometry.coordinates[0];
  } catch {
    return { ok: false, reason: "too_few_points" };
  }
  if (ring.length < 4) return { ok: false, reason: "too_few_points" };

  const shape = polygon([ring]);
  if (kinks(shape).features.length > 0) return { ok: false, reason: "self_intersection" };
  const areaHa = area(shape) / 10_000;
  if (areaHa < MIN_AREA_HA) return { ok: false, reason: "too_small" };
  return { ok: true, polygon: shape.geometry, areaHa, dropped };
}
