/**
 * Server side of the Telegram Mini App: who is asking, what they need to do, and
 * turning a walked GPS track into a plot boundary.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { farmers, fieldAgents, gaps, plots } from "@/db/schema";
import { repairPlot } from "@/domain/geometry";
import type { PlotGeometry } from "@/domain/types";
import { walkToPolygon, type WalkPoint } from "@/domain/walk";
import { verifyInitData } from "@/integrations/telegram";
import { EVENTS, type Emit } from "@/workflows/events";
import { recapturePlot } from "./plots";

type Agent = typeof fieldAgents.$inferSelect;

/**
 * With a bot token configured, only Telegram-signed init data identifies a field agent.
 * Without one (local demo), a picker can choose a field agent, and the UI says so.
 */
export async function resolveFieldAgent(
  db: Db,
  body: { initData?: string; demoAgentId?: string },
  botToken: string | undefined,
): Promise<Agent | null> {
  if (botToken) {
    if (!body.initData) return null;
    const v = verifyInitData(body.initData, botToken);
    if (!v.ok) return null;
    const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.telegramChatId, v.userId));
    return agent ?? null;
  }
  if (!body.demoAgentId) return null;
  const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, body.demoAgentId));
  return agent ?? null;
}

/** Where to start walking: the plot's centre, with swapped coordinates corrected. */
function startOf(g: PlotGeometry | null): [number, number] | null {
  if (!g) return null;
  const fixed = repairPlot(g).geometry;
  const pts = fixed.type === "Point" ? [fixed.coordinates] : fixed.type === "Polygon" ? fixed.coordinates[0] : fixed.coordinates[0][0];
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

export async function fieldTasks(db: Db, agent: Agent) {
  const rows = await db
    .select({ need: gaps.need, reason: gaps.reason, plotRef: plots.ref, geometry: plots.geometry, farmer: farmers.nameLatin, declaredAreaHa: plots.declaredAreaHa })
    .from(gaps)
    .innerJoin(plots, eq(plots.id, gaps.plotId))
    .innerJoin(farmers, eq(farmers.id, plots.farmerId))
    .where(and(eq(gaps.fieldAgentId, agent.id), eq(gaps.status, "open")))
    .orderBy(plots.ref);
  return rows.map((r) => ({
    plotRef: r.plotRef,
    farmer: r.farmer ?? "",
    need: r.need,
    reason: r.reason,
    declaredAreaHa: r.declaredAreaHa,
    start: startOf(r.geometry),
  }));
}

export type WalkSubmission = { plotRef: string; points: WalkPoint[]; simulated?: boolean };
export type WalkOutcome =
  | { ok: true; areaHa: number; dropped: number }
  | { ok: false; reason: "not_your_task" | "too_few_points" | "self_intersection" | "invalid_boundary" };

const WALKABLE = ["boundary", "location", "confirm"] as const;

export async function submitWalk(deps: { db: Db; emit: Emit }, agent: Agent, input: WalkSubmission): Promise<WalkOutcome> {
  const { db } = deps;
  const [task] = await db
    .select({ plotId: plots.id })
    .from(gaps)
    .innerJoin(plots, eq(plots.id, gaps.plotId))
    .where(and(eq(gaps.fieldAgentId, agent.id), eq(gaps.status, "open"), eq(plots.ref, input.plotRef), inArray(gaps.need, [...WALKABLE])));
  if (!task) return { ok: false, reason: "not_your_task" };

  const walked = walkToPolygon(input.points);
  if (!walked.ok) return { ok: false, reason: walked.reason };

  const { validation } = await recapturePlot(db, {
    orgId: agent.orgId,
    plotId: task.plotId,
    geometry: walked.polygon,
    source: "mini_app_walk",
    fieldAgentId: agent.id,
  });
  if (!validation.ok) return { ok: false, reason: "invalid_boundary" };

  await recordEvent(db, {
    orgId: agent.orgId,
    type: "field.replied",
    payload: { fieldAgentId: agent.id, intent: "boundary_submitted", plotRefs: [input.plotRef], simulated: Boolean(input.simulated), points: input.points.length },
  });
  await deps.emit({ name: EVENTS.fieldReplied, data: { orgId: agent.orgId, fieldAgentId: agent.id, intent: "boundary_submitted", plotRefs: [input.plotRef] } });
  await deps.emit({ name: EVENTS.plotScreenRequested, data: { orgId: agent.orgId, plotId: task.plotId } });
  return { ok: true, areaHa: walked.areaHa, dropped: walked.dropped };
}
