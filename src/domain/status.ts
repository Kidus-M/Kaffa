/**
 * The only code that sets a plot's compliance status. Agents can read the result,
 * never write it. Every result carries the rules version that produced it.
 */
import { BLOCK_FRACTION, BLOCK_HA, REQUIRED_SOURCES, RULES_VERSION } from "@/config/policy";
import type { PlotStatus } from "./types";

export type { PlotStatus };

export type SourceId = "gfw_loss" | "gfw_alerts" | "whisp";

export type SourceResult = {
  source: SourceId;
  /** False when the source errored, timed out or was rate limited. */
  available: boolean;
  /** Tree cover loss after the cut-off date, in hectares. */
  lossHa: number;
  /** Deforestation alerts after the cut-off date. */
  alertCount: number;
  datasetVersion: string;
};

export type PlotEvaluation = { status: PlotStatus; agreement: number; reasons: string[]; rulesVersion: string };

export function blockThresholdHa(areaHa: number): number {
  return Math.min(BLOCK_FRACTION * areaHa, BLOCK_HA);
}

export function evaluatePlot(input: {
  geometryOk: boolean;
  areaHa: number;
  results: SourceResult[];
  requiredSources?: readonly string[];
}): PlotEvaluation {
  const rulesVersion = RULES_VERSION;
  if (!input.geometryOk) return { status: "not_checked", agreement: 0, reasons: ["invalid_geometry"], rulesVersion };

  const available = input.results.filter((r) => r.available);
  const flags = available.filter((r) => r.lossHa > 0 || r.alertCount > 0);
  const agreement = available.length ? Math.max(flags.length, available.length - flags.length) / available.length : 0;
  const maxLoss = Math.max(0, ...available.map((r) => r.lossHa));

  // Clear evidence of loss blocks a plot whatever else is missing: failing safe never needs more data.
  if (maxLoss > 0 && maxLoss >= blockThresholdHa(input.areaHa)) {
    return { status: "blocked", agreement, reasons: ["loss_above_threshold"], rulesVersion };
  }

  const required = input.requiredSources ?? REQUIRED_SOURCES;
  const missing = required.filter((s) => !available.some((r) => r.source === s));
  if (missing.length) {
    return { status: "not_checked", agreement, reasons: missing.map((s) => `missing_source:${s}`), rulesVersion };
  }

  if (flags.length) {
    const reasons: string[] = [];
    if (maxLoss > 0) reasons.push("loss_below_threshold");
    if (available.some((r) => r.alertCount > 0)) reasons.push("recent_alerts");
    if (flags.length < available.length) reasons.push("sources_disagree");
    return { status: "review", agreement, reasons, rulesVersion };
  }

  return { status: "clear", agreement, reasons: [], rulesVersion };
}
