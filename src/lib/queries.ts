/**
 * Read models for the console and portal. Pure reads; all writes go through services.
 */
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadChain } from "@/db/events";
import {
  agentRuns,
  agentSteps,
  approvals,
  checks,
  farmers,
  fieldAgents,
  gaps,
  ledgerEntries,
  lotPlots,
  lots,
  messages,
  plots,
  shipments,
} from "@/db/schema";
import { forecastShipment, type Forecast } from "@/domain/forecast";
import type { PlotStatus } from "@/domain/types";

export const DEADLINE = "2026-12-30";
const DAY_MS = 86_400_000;

/** "19 November" from YYYY-MM-DD. */
export const dayMonth = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

export const today = () => new Date().toISOString().slice(0, 10);
export const daysUntil = (iso: string, from = today()) =>
  Math.ceil((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export type PlotTile = { id: string; ref: string; status: PlotStatus; reviewAccepted: boolean; openRequests: number };
export type LotView = { id: string; ref: string; grade: string; quantityKg: number; state: "ready" | "held"; plots: PlotTile[] };
export type ShipmentView = {
  id: string;
  ref: string;
  buyerName: string;
  destinationPort: string;
  shipDate: string;
  portalToken: string;
  lots: LotView[];
  forecast: Forecast;
};

/** Days each field agent took to close past requests: the forecast's evidence. */
async function resolutionHistory(db: Db, orgId: string) {
  const rows = await db
    .select({ fieldAgentId: gaps.fieldAgentId, openedAt: gaps.openedAt, resolvedAt: gaps.resolvedAt })
    .from(gaps)
    .where(and(eq(gaps.orgId, orgId), eq(gaps.status, "resolved"), isNotNull(gaps.resolvedAt)));
  const byAgent: Record<string, number[]> = {};
  for (const r of rows) {
    const days = Math.max(0.1, (Date.parse(r.resolvedAt!) - Date.parse(r.openedAt)) / DAY_MS);
    (byAgent[r.fieldAgentId] ??= []).push(days);
  }
  return { byAgent, all: Object.values(byAgent).flat() };
}

export async function getShipments(db: Db, orgId: string): Promise<ShipmentView[]> {
  const ships = await db.select().from(shipments).where(eq(shipments.orgId, orgId)).orderBy(asc(shipments.shipDate));
  const lotRows = await db.select().from(lots).where(eq(lots.orgId, orgId)).orderBy(asc(lots.ref));
  const tileRows = await db
    .select({
      lotId: lotPlots.lotId,
      id: plots.id,
      ref: plots.ref,
      status: plots.status,
      reviewAccepted: plots.reviewAccepted,
      fieldAgentId: plots.fieldAgentId,
    })
    .from(lotPlots)
    .innerJoin(plots, eq(plots.id, lotPlots.plotId))
    .where(eq(plots.orgId, orgId))
    .orderBy(asc(plots.ref));
  const openGaps = await db
    .select({ plotId: gaps.plotId, fieldAgentId: gaps.fieldAgentId })
    .from(gaps)
    .where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open")));
  const openByPlot = new Map<string, number>();
  for (const g of openGaps) openByPlot.set(g.plotId, (openByPlot.get(g.plotId) ?? 0) + 1);
  const history = await resolutionHistory(db, orgId);

  return ships.map((s) => {
    const shipLots = lotRows.filter((l) => l.shipmentId === s.id);
    const lotViews: LotView[] = shipLots.map((l) => ({
      id: l.id,
      ref: l.ref,
      grade: l.grade,
      quantityKg: l.quantityKg,
      state: l.state,
      plots: tileRows
        .filter((t) => t.lotId === l.id)
        .map((t) => ({ id: t.id, ref: t.ref, status: t.status, reviewAccepted: t.reviewAccepted, openRequests: openByPlot.get(t.id) ?? 0 })),
    }));
    const plotIds = new Set(lotViews.flatMap((l) => l.plots.map((p) => p.id)));
    const openGapsByAgent: Record<string, number> = {};
    for (const g of openGaps) if (plotIds.has(g.plotId)) openGapsByAgent[g.fieldAgentId] = (openGapsByAgent[g.fieldAgentId] ?? 0) + 1;
    // Plots not yet screened also need work before the ship date; count them against their field agent.
    for (const t of tileRows)
      if (plotIds.has(t.id) && t.status === "not_checked" && !openByPlot.has(t.id) && t.fieldAgentId)
        openGapsByAgent[t.fieldAgentId] = (openGapsByAgent[t.fieldAgentId] ?? 0) + 1;

    const forecast = forecastShipment({
      now: today(),
      shipDate: s.shipDate,
      openGapsByAgent,
      historyDaysByAgent: history.byAgent,
      orgHistoryDays: history.all,
    });
    return { id: s.id, ref: s.ref, buyerName: s.buyerName, destinationPort: s.destinationPort, shipDate: s.shipDate, portalToken: s.portalToken, lots: lotViews, forecast };
  });
}

export async function getAttention(db: Db, orgId: string) {
  const pending = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.orgId, orgId), eq(approvals.status, "pending")))
    .orderBy(desc(approvals.createdAt));
  const reviews = await db
    .select({ id: plots.id, ref: plots.ref, reasons: plots.statusReasons })
    .from(plots)
    .where(and(eq(plots.orgId, orgId), eq(plots.status, "review"), eq(plots.reviewAccepted, false)));
  const openRequests = await db
    .select({ id: gaps.id, need: gaps.need, reason: gaps.reason, plotRef: plots.ref, agent: fieldAgents.name, reminders: gaps.reminders })
    .from(gaps)
    .innerJoin(plots, eq(plots.id, gaps.plotId))
    .innerJoin(fieldAgents, eq(fieldAgents.id, gaps.fieldAgentId))
    .where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open")))
    .orderBy(asc(plots.ref));
  return { pending, reviews, openRequests };
}

export async function getRecentEvents(db: Db, orgId: string, limit = 12) {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.orgId, orgId)).orderBy(desc(ledgerEntries.seq)).limit(limit);
}

export async function getLedgerStatus(db: Db, orgId: string) {
  const { entries, verification } = await loadChain(db, orgId);
  return { count: entries.length, verification };
}

export async function getPlots(db: Db, orgId: string) {
  return db
    .select({
      id: plots.id,
      ref: plots.ref,
      status: plots.status,
      geometry: plots.geometry,
      areaHa: plots.areaHa,
      declaredAreaHa: plots.declaredAreaHa,
      issues: plots.issues,
      farmer: farmers.nameLatin,
    })
    .from(plots)
    .innerJoin(farmers, eq(farmers.id, plots.farmerId))
    .where(eq(plots.orgId, orgId))
    .orderBy(asc(plots.ref));
}

export async function getPlotDetail(db: Db, orgId: string, ref: string) {
  const [plot] = await db
    .select({ plot: plots, farmer: farmers, agent: fieldAgents })
    .from(plots)
    .innerJoin(farmers, eq(farmers.id, plots.farmerId))
    .leftJoin(fieldAgents, eq(fieldAgents.id, plots.fieldAgentId))
    .where(and(eq(plots.orgId, orgId), eq(plots.ref, ref)));
  if (!plot) return null;
  const plotChecks = await db.select().from(checks).where(eq(checks.plotId, plot.plot.id)).orderBy(desc(checks.createdAt)).limit(6);
  const requests = await db.select().from(gaps).where(eq(gaps.plotId, plot.plot.id)).orderBy(desc(gaps.openedAt));
  const [lot] = await db
    .select({ ref: lots.ref, state: lots.state })
    .from(lotPlots)
    .innerJoin(lots, eq(lots.id, lotPlots.lotId))
    .where(eq(lotPlots.plotId, plot.plot.id));
  const history = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.orgId, orgId)).orderBy(desc(ledgerEntries.seq)))
    .filter((e) => (e.payload as { plotRef?: string })?.plotRef === ref)
    .slice(0, 10);
  return { ...plot, checks: plotChecks, requests, lot, history };
}

export async function getActivity(db: Db, orgId: string, limit = 25) {
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.orgId, orgId)).orderBy(desc(agentRuns.startedAt)).limit(limit);
  const steps = runs.length
    ? await db.select().from(agentSteps).where(inArray(agentSteps.runId, runs.map((r) => r.id))).orderBy(asc(agentSteps.idx))
    : [];
  return runs.map((r) => ({ ...r, steps: steps.filter((s) => s.runId === r.id) }));
}

export async function getFieldAgents(db: Db, orgId: string) {
  const agents = await db.select().from(fieldAgents).where(eq(fieldAgents.orgId, orgId)).orderBy(asc(fieldAgents.name));
  const msgs = await db.select().from(messages).where(eq(messages.orgId, orgId)).orderBy(desc(messages.createdAt)).limit(60);
  return agents.map((a) => ({ ...a, messages: msgs.filter((m) => m.fieldAgentId === a.id).reverse() }));
}

export async function getShipmentByToken(db: Db, token: string) {
  const [s] = await db.select().from(shipments).where(eq(shipments.portalToken, token));
  return s ?? null;
}

/** Plot counts by status, for the overview's headline figures. */
export async function getPlotCounts(db: Db, orgId: string) {
  const rows = await db.select({ status: plots.status, reviewAccepted: plots.reviewAccepted }).from(plots).where(eq(plots.orgId, orgId));
  const counts: Record<PlotStatus, number> = { clear: 0, review: 0, blocked: 0, not_checked: 0 };
  let accepted = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (r.status === "review" && r.reviewAccepted) accepted++;
  }
  return { ...counts, accepted, total: rows.length };
}
