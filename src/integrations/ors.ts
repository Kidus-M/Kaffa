/**
 * openrouteservice travel-time matrix (free key with daily quotas). Returns minutes, or
 * null when there is no key or the call fails, so the planner falls back to estimates.
 */
import type { LonLat } from "@/domain/route";

/** Minutes assumed for a pair with no road between them: a long walk, not a broken plan. */
const NO_ROAD_MINUTES = 240;

export async function roadMatrix(points: LonLat[], apiKey: string | undefined, f: typeof fetch = fetch): Promise<number[][] | null> {
  if (!apiKey || points.length < 2) return null;
  try {
    const res = await f("https://api.openrouteservice.org/v2/matrix/driving-car", {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ locations: points, metrics: ["duration"] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { durations?: (number | null)[][] };
    if (!body.durations) return null;
    return body.durations.map((row) => row.map((s) => (s == null ? NO_ROAD_MINUTES : Math.round(s / 60))));
  } catch {
    return null;
  }
}
