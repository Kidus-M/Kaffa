/**
 * Global Forest Watch Data API client.
 * Live: POST /dataset/{id}/{version}/query/json with an SQL string and a GeoJSON geometry
 * (https://developer.openepi.io/how-tos/getting-started-using-global-forest-watch-data-api).
 * Without a key it runs in a deterministic simulated mode, and every result says so.
 */
import { centroid } from "@turf/turf";
import { CUTOFF_DATE } from "@/config/policy";
import type { SourceResult } from "@/domain/status";
import type { AreaGeometry } from "@/domain/types";

const BASE = "https://data-api.globalforestwatch.org";
const LOSS_DATASET = "umd_tree_cover_loss";
const ALERTS_DATASET = "gfw_integrated_alerts";
/** Field names and versions to confirm against /dataset/{id}/{version}/fields once a key is available. */
const VERSION = "latest";
const FIRST_LOSS_YEAR = Number(CUTOFF_DATE.slice(0, 4)) + 1;
const TIMEOUT_MS = 20_000;

export type GfwClient = {
  simulated: boolean;
  treeCoverLoss(g: AreaGeometry): Promise<SourceResult>;
  integratedAlerts(g: AreaGeometry, sinceIso: string): Promise<SourceResult>;
};

type Row = Record<string, number | string | null>;

export function createGfwClient(opts: { apiKey?: string; origin?: string; fetch?: typeof fetch }): GfwClient {
  if (!opts.apiKey) return simulatedClient();
  const f = opts.fetch ?? fetch;
  const apiKey = opts.apiKey;

  async function query(dataset: string, sql: string, geometry: AreaGeometry): Promise<Row[] | null> {
    try {
      const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": apiKey };
      if (opts.origin) headers.origin = opts.origin.startsWith("http") ? opts.origin : `https://${opts.origin}`;
      const res = await f(`${BASE}/dataset/${dataset}/${VERSION}/query/json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sql, geometry }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: Row[] };
      return Array.isArray(body.data) ? body.data : null;
    } catch {
      return null;
    }
  }

  const unavailable = (source: SourceResult["source"], dataset: string): SourceResult => ({
    source,
    available: false,
    lossHa: 0,
    alertCount: 0,
    datasetVersion: `${dataset}/${VERSION}`,
  });

  return {
    simulated: false,
    async treeCoverLoss(g) {
      const sql =
        `SELECT umd_tree_cover_loss__year, SUM(area__ha) AS area__ha FROM results ` +
        `WHERE umd_tree_cover_loss__year >= ${FIRST_LOSS_YEAR} GROUP BY umd_tree_cover_loss__year`;
      const rows = await query(LOSS_DATASET, sql, g);
      if (!rows) return unavailable("gfw_loss", LOSS_DATASET);
      const lossHa = rows.reduce((s, r) => s + Number(r.area__ha ?? 0), 0);
      return { source: "gfw_loss", available: true, lossHa, alertCount: 0, datasetVersion: `${LOSS_DATASET}/${VERSION}` };
    },
    async integratedAlerts(g, sinceIso) {
      const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceIso) ? sinceIso : "2021-01-01";
      const sql =
        `SELECT COUNT(*) AS alert_count, SUM(area__ha) AS area__ha FROM results ` +
        `WHERE gfw_integrated_alerts__date >= '${since}'`;
      const rows = await query(ALERTS_DATASET, sql, g);
      if (!rows) return unavailable("gfw_alerts", ALERTS_DATASET);
      const alertCount = Number(rows[0]?.alert_count ?? 0);
      return { source: "gfw_alerts", available: true, lossHa: 0, alertCount, datasetVersion: `${ALERTS_DATASET}/${VERSION}` };
    },
  };
}

/** Stable pseudo-random number in [0, 1) from a plot's location, so the demo is repeatable. */
function locationHash(g: AreaGeometry, salt: number): number {
  const [x, y] = centroid(g).geometry.coordinates;
  let h = Math.imul(Math.round(x * 1e5) ^ salt, 2654435761) ^ Math.imul(Math.round(y * 1e5), 2246822519);
  h = Math.imul(h ^ (h >>> 15), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Most plots come back clean; about 1 in 12 has small post-2020 loss and about 1 in 10
 * has alerts, so the demo exercises clear, review and blocked plots.
 */
function simulatedClient(): GfwClient {
  return {
    simulated: true,
    async treeCoverLoss(g) {
      const r = locationHash(g, 17);
      const lossHa = r < 0.08 ? Math.round((0.05 + r * 6) * 100) / 100 : 0;
      return { source: "gfw_loss", available: true, lossHa, alertCount: 0, datasetVersion: `${LOSS_DATASET}/simulated` };
    },
    async integratedAlerts(g) {
      const r = locationHash(g, 91);
      return {
        source: "gfw_alerts",
        available: true,
        lossHa: 0,
        alertCount: r < 0.1 ? 1 + Math.floor(r * 30) : 0,
        datasetVersion: `${ALERTS_DATASET}/simulated`,
      };
    },
  };
}
