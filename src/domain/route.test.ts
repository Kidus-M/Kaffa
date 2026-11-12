import { describe, expect, it } from "vitest";
import { mulberry32 } from "./random";
import { estimateMatrix, haversineKm, planVisits, solveTour, tourMinutes, type LonLat } from "./route";

const base: LonLat = [38.215, 6.095];

describe("haversineKm", () => {
  it("measures about 111 km per degree of latitude", () => {
    expect(haversineKm([38, 6], [38, 7])).toBeCloseTo(111.2, 0);
  });
});

describe("solveTour", () => {
  it("visits every node once and returns to the start", () => {
    const m = estimateMatrix([base, [38.22, 6.1], [38.21, 6.08], [38.23, 6.09]]);
    const tour = solveTour(m);
    expect(tour[0]).toBe(0);
    expect(tour.at(-1)).toBe(0);
    expect([...tour.slice(1, -1)].sort()).toEqual([1, 2, 3]);
  });

  it("finds the optimal tour on small random instances", () => {
    const rand = mulberry32(3);
    let optimal = 0;
    for (let n = 0; n < 30; n++) {
      const pts: LonLat[] = [base, ...Array.from({ length: 6 }, (): LonLat => [38.2 + rand() * 0.05, 6.07 + rand() * 0.05])];
      const m = estimateMatrix(pts);
      const got = tourMinutes(solveTour(m), m);
      const best = bruteForce(m);
      expect(got).toBeGreaterThanOrEqual(best);
      if (got === best) optimal++;
    }
    // 2-opt is a heuristic; on six stops it should be optimal nearly always.
    expect(optimal).toBeGreaterThanOrEqual(27);
  });
});

describe("planVisits", () => {
  const stops = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, label: `KNG-${i}`, position: [38.2 + (i % 4) * 0.01, 6.08 + Math.floor(i / 4) * 0.01] as LonLat }));
  const dry = (date: string) => ({ date, precipitationMm: 1, precipitationProbability: 20 });

  it("splits visits into working days and schedules every stop", () => {
    const r = planVisits({ base, stops, days: ["2026-11-13", "2026-11-14", "2026-11-15"].map(dry) });
    expect(r.unscheduled).toEqual([]);
    expect(r.days.length).toBeGreaterThan(1);
    for (const d of r.days) expect(d.totalMinutes).toBeLessThanOrEqual(7 * 60);
    expect(r.days.flatMap((d) => d.stops.map((s) => s.id)).sort()).toEqual(stops.map((s) => s.id).sort());
    expect(r.estimated).toBe(true);
  });

  it("skips days with heavy rain forecast", () => {
    const r = planVisits({
      base,
      stops: stops.slice(0, 3),
      days: [{ date: "2026-11-13", precipitationMm: 25, precipitationProbability: 90 }, dry("2026-11-14")],
    });
    expect(r.days.map((d) => d.date)).toEqual(["2026-11-14"]);
    expect(r.skippedDays.map((d) => d.date)).toEqual(["2026-11-13"]);
  });

  it("reports visits that do not fit the available days", () => {
    const r = planVisits({ base, stops, days: [dry("2026-11-13")] });
    expect(r.unscheduled.length).toBeGreaterThan(0);
  });
});

function bruteForce(m: number[][]): number {
  const nodes = m.map((_, i) => i).slice(1);
  let best = Infinity;
  const permute = (rest: number[], path: number[]) => {
    if (!rest.length) {
      best = Math.min(best, tourMinutes([0, ...path, 0], m));
      return;
    }
    rest.forEach((n, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...path, n]));
  };
  permute(nodes, []);
  return best;
}
