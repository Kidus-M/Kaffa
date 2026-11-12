/**
 * Field visit routing. Orders a field agent's visits with nearest-neighbour then 2-opt
 * over a travel-time matrix, splits the tour into working days, and moves days away
 * from forecast heavy rain.
 */
import { RAIN_SKIP_MM, RAIN_SKIP_PROBABILITY, ROAD_DETOUR, ROAD_KMH, VISIT_MINUTES, WORKDAY_MINUTES } from "@/config/policy";

export type LonLat = [number, number];

export function haversineKm([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Travel minutes estimated from straight-line distance, used when road data is unavailable. */
export function estimateMatrix(points: LonLat[]): number[][] {
  return points.map((a) => points.map((b) => Math.round(((haversineKm(a, b) * ROAD_DETOUR) / ROAD_KMH) * 60)));
}

export function tourMinutes(order: number[], m: number[][]): number {
  let t = 0;
  for (let i = 0; i < order.length - 1; i++) t += m[order[i]][order[i + 1]];
  return t;
}

/** A closed tour from node 0 through every other node and back to 0. */
export function solveTour(m: number[][]): number[] {
  const n = m.length;
  if (n <= 2) return n === 2 ? [0, 1, 0] : [0];
  const seen = new Set([0]);
  const tour = [0];
  while (tour.length < n) {
    const last = tour[tour.length - 1];
    let next = -1;
    for (let j = 0; j < n; j++) if (!seen.has(j) && (next < 0 || m[last][j] < m[last][next])) next = j;
    tour.push(next);
    seen.add(next);
  }
  tour.push(0);
  // 2-opt: reverse any segment that shortens the tour, until none does.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < tour.length - 2; i++)
      for (let k = i + 1; k < tour.length - 1; k++) {
        const delta =
          m[tour[i - 1]][tour[k]] + m[tour[i]][tour[k + 1]] - m[tour[i - 1]][tour[i]] - m[tour[k]][tour[k + 1]];
        if (delta < -1e-9) {
          tour.splice(i, k - i + 1, ...tour.slice(i, k + 1).reverse());
          improved = true;
        }
      }
  }
  return tour;
}

export type DayWeather = { date: string; precipitationMm: number; precipitationProbability: number };
export type VisitStop = { id: string; label: string; position: LonLat; minutes?: number };

export type DayPlan = {
  date: string;
  stops: { id: string; label: string; arriveMinute: number; travelMinutes: number }[];
  travelMinutes: number;
  totalMinutes: number;
  weather: DayWeather | null;
};

export function isWetDay(w: DayWeather): boolean {
  return w.precipitationMm >= RAIN_SKIP_MM || w.precipitationProbability >= RAIN_SKIP_PROBABILITY;
}

/**
 * Plans visits from a base (the cooperative) over the coming days. Visits follow one
 * optimised tour, cut into days that fit a working day including the trip home; days
 * with heavy rain forecast are skipped.
 */
export function planVisits(input: {
  base: LonLat;
  stops: VisitStop[];
  /** Travel minutes between [base, ...stops]; estimated from distance when absent. */
  matrix?: number[][];
  days: DayWeather[];
}): { days: DayPlan[]; unscheduled: string[]; skippedDays: DayWeather[]; estimated: boolean } {
  const points = [input.base, ...input.stops.map((s) => s.position)];
  const m = input.matrix ?? estimateMatrix(points);
  const tour = solveTour(m).slice(1, -1);
  const usable = input.days.filter((d) => !isWetDay(d));
  const skippedDays = input.days.filter(isWetDay);

  const days: DayPlan[] = [];
  let cursor = 0;
  for (const day of usable) {
    if (cursor >= tour.length) break;
    const plan: DayPlan = { date: day.date, stops: [], travelMinutes: 0, totalMinutes: 0, weather: day };
    let at = 0;
    let clock = 0;
    while (cursor < tour.length) {
      const node = tour[cursor];
      const stop = input.stops[node - 1];
      const travel = m[at][node];
      const visit = stop.minutes ?? VISIT_MINUTES;
      if (plan.stops.length > 0 && clock + travel + visit + m[node][0] > WORKDAY_MINUTES) break;
      clock += travel;
      plan.stops.push({ id: stop.id, label: stop.label, arriveMinute: clock, travelMinutes: travel });
      plan.travelMinutes += travel;
      clock += visit;
      at = node;
      cursor++;
    }
    plan.travelMinutes += m[at][0];
    plan.totalMinutes = clock + m[at][0];
    days.push(plan);
  }
  const unscheduled = tour.slice(cursor).map((n) => input.stops[n - 1].id);
  return { days, unscheduled, skippedDays, estimated: !input.matrix };
}
