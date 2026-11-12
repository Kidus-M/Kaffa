/**
 * Open-Meteo daily rain forecast (free, no key, under 10,000 calls a day for
 * non-commercial use). When it cannot be reached, a deterministic simulated forecast is
 * returned and labelled, so visit planning still works.
 */
import type { DayWeather, LonLat } from "@/domain/route";
import { mulberry32 } from "@/domain/random";

export type RainForecast = { days: DayWeather[]; simulated: boolean };

/** Successful forecasts per place for an hour, so agents of one cooperative plan on the same weather. */
const cache = new Map<string, { at: number; value: RainForecast }>();
const CACHE_MS = 60 * 60_000;

export async function rainForecast(position: LonLat, days = 7, f: typeof fetch = fetch): Promise<RainForecast> {
  const [lon, lat] = position;
  const key = `${lon.toFixed(2)},${lat.toFixed(2)},${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS && f === fetch) return hit.value;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&daily=precipitation_sum,precipitation_probability_max&timezone=Africa%2FAddis_Ababa&forecast_days=${days}`;
  try {
    const res = await f(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as {
      daily?: { time: string[]; precipitation_sum: (number | null)[]; precipitation_probability_max: (number | null)[] };
    };
    const d = body.daily;
    if (!d?.time?.length) throw new Error("no daily data");
    const value: RainForecast = {
      simulated: false,
      days: d.time.map((date, i) => ({
        date,
        precipitationMm: d.precipitation_sum[i] ?? 0,
        precipitationProbability: d.precipitation_probability_max[i] ?? 0,
      })),
    };
    if (f === fetch) cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return simulatedForecast(days);
  }
}

export function simulatedForecast(days = 7, from = new Date()): RainForecast {
  const rand = mulberry32(Number(from.toISOString().slice(0, 10).replaceAll("-", "")));
  return {
    simulated: true,
    days: Array.from({ length: days }, (_, i) => {
      const date = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      // One wet day, so the demo shows a visit moved away from rain.
      const wet = i === 1;
      return { date, precipitationMm: wet ? 18 : Math.round(rand() * 40) / 10, precipitationProbability: wet ? 85 : Math.round(rand() * 40) };
    }),
  };
}
