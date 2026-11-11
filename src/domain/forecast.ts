/**
 * Probability that a shipment is ready by its ship date, by Monte Carlo simulation.
 *
 * Model: every open gap is fixed after a delay drawn (bootstrap) from how long its
 * field agent has taken before. Agents work in parallel, so a run's ready date is
 * now plus the longest delay across all gaps. Sparse histories fall back to the
 * organisation's history, then to a fixed prior. Seeded, so results are reproducible.
 */
import { FORECAST_MIN_SAMPLES, FORECAST_PRIOR_DAYS, FORECAST_RUNS, FORECAST_SEED } from "@/config/policy";
import { mulberry32 } from "./random";

export type ForecastInput = {
  /** YYYY-MM-DD */
  now: string;
  /** YYYY-MM-DD */
  shipDate: string;
  openGapsByAgent: Record<string, number>;
  /** Past gap resolution times per field agent, in days. */
  historyDaysByAgent: Record<string, number[]>;
  orgHistoryDays: number[];
  runs?: number;
  seed?: number;
};

export type Forecast = {
  pOnTime: number;
  p50: string;
  p90: string;
  runs: number;
  basis: Record<string, "agent" | "org" | "prior">;
};

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const fromDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);

export function forecastShipment(input: ForecastInput): Forecast {
  const runs = input.runs ?? FORECAST_RUNS;
  const rand = mulberry32(input.seed ?? FORECAST_SEED);
  const today = toDay(input.now);
  const deadline = toDay(input.shipDate);

  const basis: Forecast["basis"] = {};
  const pools: { samples: number[]; gaps: number }[] = [];
  for (const [agent, gaps] of Object.entries(input.openGapsByAgent)) {
    if (gaps <= 0) continue;
    const own = input.historyDaysByAgent[agent] ?? [];
    const samples =
      own.length >= FORECAST_MIN_SAMPLES
        ? ((basis[agent] = "agent"), own)
        : input.orgHistoryDays.length >= FORECAST_MIN_SAMPLES
          ? ((basis[agent] = "org"), input.orgHistoryDays)
          : ((basis[agent] = "prior"), FORECAST_PRIOR_DAYS);
    pools.push({ samples, gaps });
  }

  if (pools.length === 0) {
    return { pOnTime: today <= deadline ? 1 : 0, p50: fromDay(today), p90: fromDay(today), runs, basis };
  }

  const readyDays = new Array<number>(runs);
  let onTime = 0;
  for (let i = 0; i < runs; i++) {
    let longest = 0;
    for (const { samples, gaps } of pools) {
      for (let g = 0; g < gaps; g++) {
        const d = samples[Math.floor(rand() * samples.length)];
        if (d > longest) longest = d;
      }
    }
    const ready = today + Math.ceil(longest);
    readyDays[i] = ready;
    if (ready <= deadline) onTime++;
  }
  readyDays.sort((a, b) => a - b);
  const pct = (p: number) => readyDays[Math.min(runs - 1, Math.floor(p * runs))];
  return { pOnTime: onTime / runs, p50: fromDay(pct(0.5)), p90: fromDay(pct(0.9)), runs, basis };
}
