/**
 * Shipment planner: estimates each lot's chance of being ready by each ship date, solves
 * the container allocation, and proposes the smallest change when a lot is held.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { flags, gaps, lotPlots, lots, plots, shipments } from "@/db/schema";
import { forecastShipment } from "@/domain/forecast";
import { planContainers, scoreCurrent, type Plan, type PlanLot, type PlanShipment } from "@/domain/planner";
import { resolutionHistory, today } from "@/lib/queries";
import { modeFor, requestApproval } from "./autonomy";
import { startTrace } from "./trace";

/** Held lots that need a person's decision rather than field work get this chance. Design choice. */
const NEEDS_DECISION_P = 0.05;
/** A review plot waiting for acceptance. Design choice. */
const AWAITING_REVIEW_P = 0.6;

export type LotReadiness = PlanLot & { why: string };

export async function lotReadiness(db: Db, orgId: string): Promise<{ lots: LotReadiness[]; shipments: (PlanShipment & { shipDate: string })[] }> {
  const ships = await db.select().from(shipments).where(eq(shipments.orgId, orgId)).orderBy(shipments.shipDate);
  const lotRows = await db.select().from(lots).where(eq(lots.orgId, orgId)).orderBy(lots.ref);
  const tiles = await db
    .select({ lotId: lotPlots.lotId, plotId: plots.id, status: plots.status, reviewAccepted: plots.reviewAccepted, fieldAgentId: plots.fieldAgentId })
    .from(lotPlots)
    .innerJoin(plots, eq(plots.id, lotPlots.plotId))
    .where(eq(plots.orgId, orgId));
  const open = await db.select({ plotId: gaps.plotId, fieldAgentId: gaps.fieldAgentId }).from(gaps).where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open")));
  const flagged = await db
    .select({ lotId: flags.lotId, n: sql<number>`count(*)::int` })
    .from(flags)
    .where(and(eq(flags.orgId, orgId), eq(flags.status, "open")))
    .groupBy(flags.lotId);
  const history = await resolutionHistory(db, orgId);

  const out: LotReadiness[] = lotRows.map((l) => {
    const mine = tiles.filter((t) => t.lotId === l.id);
    const pReady: Record<string, number> = {};
    let why = "Ready";
    const blocked = mine.filter((t) => t.status === "blocked").length;
    const openFlags = flagged.find((f) => f.lotId === l.id)?.n ?? 0;
    const awaitingReview = mine.some((t) => t.status === "review" && !t.reviewAccepted);
    const gapsByAgent: Record<string, number> = {};
    for (const g of open) if (mine.some((t) => t.plotId === g.plotId)) gapsByAgent[g.fieldAgentId] = (gapsByAgent[g.fieldAgentId] ?? 0) + 1;
    for (const t of mine) if (t.status === "not_checked" && !open.some((g) => g.plotId === t.plotId) && t.fieldAgentId) gapsByAgent[t.fieldAgentId] = (gapsByAgent[t.fieldAgentId] ?? 0) + 1;

    for (const s of ships) {
      if (l.state === "ready") pReady[s.id] = 1;
      else if (blocked || openFlags) pReady[s.id] = NEEDS_DECISION_P;
      else {
        const f = forecastShipment({ now: today(), shipDate: s.shipDate, openGapsByAgent: gapsByAgent, historyDaysByAgent: history.byAgent, orgHistoryDays: history.all, runs: 2_000 });
        pReady[s.id] = Math.round(f.pOnTime * (awaitingReview ? AWAITING_REVIEW_P : 1) * 1000) / 1000;
      }
    }
    if (l.state !== "ready") {
      const parts = [];
      if (blocked) parts.push(`${blocked} blocked plot${blocked > 1 ? "s" : ""}`);
      if (openFlags) parts.push(`${openFlags} supply chain flag${openFlags > 1 ? "s" : ""}`);
      const requests = open.filter((g) => mine.some((t) => t.plotId === g.plotId)).length;
      const unscreened = mine.filter((t) => t.status === "not_checked" && !open.some((g) => g.plotId === t.plotId)).length;
      if (requests) parts.push(`${requests} field request${requests > 1 ? "s" : ""}`);
      if (unscreened) parts.push(`${unscreened} plot${unscreened > 1 ? "s" : ""} not yet screened`);
      if (awaitingReview) parts.push("a review to accept");
      why = parts.join(", ") || "Held";
    }
    return { id: l.id, ref: l.ref, grade: l.grade, kg: l.quantityKg, valueUsd: l.valueUsd, currentShipmentId: l.shipmentId, pReady, why };
  });
  return {
    lots: out,
    shipments: ships.map((s) => ({ id: s.id, ref: s.ref, volumeKg: s.contractVolumeKg, gradeRequired: s.gradeRequired, shipDate: s.shipDate })),
  };
}

export type PlanView = Awaited<ReturnType<typeof getPlan>>;

export async function getPlan(db: Db, orgId: string) {
  const { lots: lotList, shipments: ships } = await lotReadiness(db, orgId);
  const plan: Plan = planContainers({ shipments: ships, lots: lotList });
  return { plan, before: scoreCurrent({ shipments: ships, lots: lotList }), lots: lotList, shipments: ships };
}

/**
 * Re-solves the plan; if it differs from the current allocation, either applies it (when
 * the exporter made allocation changes automatic) or asks for approval.
 */
export async function proposePlan(db: Db, orgId: string) {
  const trace = await startTrace(db, { orgId, agent: "shipment_planner", trigger: "plan" });
  const view = await getPlan(db, orgId);
  await trace.step("tool", "estimate_lot_readiness", null, Object.fromEntries(view.lots.map((l) => [l.ref, l.pReady])));
  await trace.step("tool", "solve_allocation", { lots: view.lots.length, shipments: view.shipments.length }, { changes: view.plan.changes, explored: view.plan.explored, pOnTime: view.plan.pOnTime });
  if (!view.plan.changes.length) {
    await trace.finish("succeeded", "The current allocation is already the best plan");
    return { ok: true as const, message: "The current allocation is already the best plan." };
  }
  const refOf = (id: string | null) => view.shipments.find((s) => s.id === id)?.ref ?? "spare";
  const summary = view.plan.changes.map((c) => `${c.lotRef}: ${refOf(c.from)} to ${refOf(c.to)}`).join("; ");
  const gain = view.shipments
    .filter((s) => view.before[s.id] !== view.plan.pOnTime[s.id])
    .map((s) => `${s.ref} ${Math.round(view.before[s.id] * 100)}% to ${Math.round(view.plan.pOnTime[s.id] * 100)}%`)
    .join(", ");
  const payload = { changes: view.plan.changes, before: view.before, after: view.plan.pOnTime };

  if ((await modeFor(db, orgId, "change_allocation")) === "auto") {
    await applyAllocation(db, orgId, view.plan.changes, "shipment planner");
    await trace.finish("succeeded", `Applied: ${summary}`);
    return { ok: true as const, message: `Applied: ${summary}. On time: ${gain}.` };
  }
  await requestApproval(db, {
    orgId,
    kind: "change_allocation",
    subjectId: view.plan.changes.map((c) => `${c.lotId}>${c.to ?? "spare"}`).join(","),
    summary: `Move ${summary}. Chance of shipping on time: ${gain}.`,
    payload,
  });
  await trace.finish("succeeded", `Proposed: ${summary}`);
  return { ok: true as const, message: `Proposed for approval: ${summary}.` };
}

export async function applyAllocation(db: Db, orgId: string, changes: Plan["changes"], by: string) {
  const ids = changes.map((c) => c.lotId);
  const current = ids.length ? await db.select({ id: lots.id, shipmentId: lots.shipmentId }).from(lots).where(and(eq(lots.orgId, orgId), inArray(lots.id, ids))) : [];
  // Apply only if nothing moved since the plan was made.
  const stale = changes.some((c) => current.find((l) => l.id === c.lotId)?.shipmentId !== c.from);
  if (stale) return { ok: false as const, message: "The allocation changed since this plan was made; re-run the planner." };
  for (const c of changes) await db.update(lots).set({ shipmentId: c.to }).where(eq(lots.id, c.lotId));
  await recordEvent(db, { orgId, type: "allocation.changed", payload: { changes: changes.map((c) => ({ lotRef: c.lotRef, from: c.from, to: c.to })), by } });
  return { ok: true as const, message: "Allocation updated." };
}
