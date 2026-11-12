/**
 * The morning brief: the three decisions that matter most today, ranked by how directly
 * they unblock a shipment. Deterministic, so it can be trusted and tested.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, fieldAgents, flags, gaps, lots, plots, shipments } from "@/db/schema";
import { dayMonth, daysUntil } from "@/lib/queries";
import { getPlan } from "./planner";

export type BriefItem = { title: string; detail: string; href: string; weight: number };

const KIND_WEIGHT: Record<string, number> = { change_allocation: 90, create_shipment: 70, send_reply: 60, buyer_question: 60, merge_farmers: 40, escalation: 50 };

export async function computeBrief(db: Db, orgId: string): Promise<BriefItem[]> {
  const items: BriefItem[] = [];
  const ships = await db.select().from(shipments).where(eq(shipments.orgId, orgId)).orderBy(asc(shipments.shipDate));

  const view = await getPlan(db, orgId);
  if (view.plan.changes.length) {
    const improved = view.shipments.filter((s) => view.plan.pOnTime[s.id] > view.before[s.id]);
    if (improved.length)
      items.push({
        title: "Swap lots to save a shipment",
        detail: improved.map((s) => `${s.ref}: ${Math.round(view.before[s.id] * 100)}% to ${Math.round(view.plan.pOnTime[s.id] * 100)}% on time`).join("; "),
        href: "/shipments",
        weight: 100,
      });
  }

  const openFlags = await db
    .select({ lotRef: lots.ref, shipmentId: lots.shipmentId, n: sql<number>`count(*)::int` })
    .from(flags)
    .innerJoin(lots, eq(lots.id, flags.lotId))
    .where(and(eq(flags.orgId, orgId), eq(flags.status, "open")))
    .groupBy(lots.ref, lots.shipmentId);
  for (const f of openFlags.filter((x) => x.shipmentId)) {
    const s = ships.find((x) => x.id === f.shipmentId);
    items.push({
      title: `Resolve the volume flags on ${f.lotRef}`,
      detail: `${f.n} supply chain flag${f.n > 1 ? "s" : ""} hold the lot${s ? `; ${s.ref} ships ${dayMonth(s.shipDate)}` : ""}.`,
      href: `/supply-chain?lot=${f.lotRef}`,
      weight: 80 + (s ? Math.max(0, 30 - daysUntil(s.shipDate)) : 0),
    });
  }

  const pending = await db.select().from(approvals).where(and(eq(approvals.orgId, orgId), eq(approvals.status, "pending"))).orderBy(asc(approvals.createdAt));
  for (const a of pending.filter((p) => p.kind !== "change_allocation").slice(0, 4))
    items.push({ title: approvalTitle(a.kind), detail: a.summary.slice(0, 160), href: "/approvals", weight: KIND_WEIGHT[a.kind] ?? 30 });

  const [{ reviews }] = await db
    .select({ reviews: sql<number>`count(*)::int` })
    .from(plots)
    .where(and(eq(plots.orgId, orgId), eq(plots.status, "review"), eq(plots.reviewAccepted, false)));
  if (reviews) items.push({ title: `Decide on ${reviews} review plot${reviews > 1 ? "s" : ""}`, detail: "Each needs a person to accept it with a reason, or remove it from its lot.", href: "/plots?status=review", weight: 65 });

  const silent = await db
    .selectDistinct({ name: fieldAgents.name })
    .from(gaps)
    .innerJoin(fieldAgents, eq(fieldAgents.id, gaps.fieldAgentId))
    .where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open"), isNull(fieldAgents.telegramChatId)));
  if (silent.length)
    items.push({
      title: `Connect ${silent.length} field agent${silent.length > 1 ? "s" : ""} to Telegram`,
      detail: `${silent.map((s) => s.name.replace(" (synthetic)", "")).join(", ")} ${silent.length > 1 ? "have" : "has"} open requests but cannot be messaged yet.`,
      href: "/field-agents",
      weight: 55,
    });

  return items.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

function approvalTitle(kind: string): string {
  return (
    {
      merge_farmers: "Confirm a duplicate farmer",
      create_shipment: "Approve a new contract from email",
      send_reply: "Approve a reply to a buyer",
      buyer_question: "Answer a buyer question",
      buyer_answer: "Approve an answer for the buyer portal",
      send_day_plan: "Approve a field agent's day plan",
      escalation: "A field agent has not replied",
      review_photo: "A field photo arrived",
    }[kind] ?? "An agent needs a decision"
  );
}
