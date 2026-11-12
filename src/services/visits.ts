/**
 * Field planner: groups the plots each field agent must visit, orders them by road
 * travel time (openrouteservice, or straight-line estimates), moves days away from heavy
 * rain (Open-Meteo), and sends each agent a day plan in Telegram.
 */
import { and, desc, eq } from "drizzle-orm";
import { centroid } from "@turf/turf";
import { dayPlanText } from "@/agents/templates";
import { ETHIOPIA_BBOX } from "@/config/policy";
import type { Db } from "@/db/client";
import { recordEvent } from "@/db/events";
import { cooperatives, fieldAgents, gaps, messages, plots, visitPlans } from "@/db/schema";
import { COOPS } from "@/db/seed-data";
import type { PlotGeometry } from "@/domain/types";
import { planVisits, type DayPlan, type DayWeather, type LonLat } from "@/domain/route";
import { roadMatrix } from "@/integrations/ors";
import type { TelegramSender } from "@/integrations/telegram";
import { rainForecast, type RainForecast } from "@/integrations/weather";
import { modeFor, requestApproval } from "./autonomy";
import { startTrace } from "./trace";

export type StoredPlan = {
  base: LonLat;
  days: (DayPlan & { stopsDetail: { plotRef: string; needs: string[]; position: LonLat; approximate: boolean }[] })[];
  unscheduled: string[];
  skippedDays: DayWeather[];
  roads: "openrouteservice" | "estimated";
  weather: "open-meteo" | "simulated";
};

export type VisitDeps = { db: Db; telegram: TelegramSender | null; orsKey?: string; weather?: (p: LonLat) => Promise<RainForecast>; fetchMatrix?: typeof roadMatrix };

const inEthiopia = ([lon, lat]: LonLat) => lat >= ETHIOPIA_BBOX.minLat && lat <= ETHIOPIA_BBOX.maxLat && lon >= ETHIOPIA_BBOX.minLon && lon <= ETHIOPIA_BBOX.maxLon;

function plotPosition(g: PlotGeometry | null): LonLat | null {
  if (!g) return null;
  const p = (g.type === "Point" ? g.coordinates : centroid(g).geometry.coordinates) as LonLat;
  return inEthiopia(p) ? [p[0], p[1]] : null;
}

/** Plans visits for one field agent and stores the plan. */
export async function planAgentVisits(deps: VisitDeps, input: { orgId: string; fieldAgentId: string }): Promise<StoredPlan | null> {
  const { db } = deps;
  const [agent] = await db.select().from(fieldAgents).where(and(eq(fieldAgents.id, input.fieldAgentId), eq(fieldAgents.orgId, input.orgId)));
  if (!agent) return null;
  const [coop] = await db.select().from(cooperatives).where(eq(cooperatives.id, agent.cooperativeId));
  const base = (COOPS.find((c) => c.id === coop?.id)?.center ?? [38.215, 6.095]) as LonLat;

  const open = await db
    .select({ need: gaps.need, plotRef: plots.ref, geometry: plots.geometry })
    .from(gaps)
    .innerJoin(plots, eq(plots.id, gaps.plotId))
    .where(and(eq(gaps.fieldAgentId, agent.id), eq(gaps.status, "open")))
    .orderBy(plots.ref);
  const byPlot = new Map<string, { needs: string[]; position: LonLat; approximate: boolean }>();
  for (const g of open) {
    const known = plotPosition(g.geometry);
    const entry = byPlot.get(g.plotRef) ?? { needs: [], position: known ?? base, approximate: !known };
    entry.needs.push(g.need);
    byPlot.set(g.plotRef, entry);
  }
  if (!byPlot.size) {
    await db.delete(visitPlans).where(eq(visitPlans.fieldAgentId, agent.id));
    return null;
  }

  const trace = await startTrace(db, { orgId: input.orgId, agent: "field_planner", trigger: agent.name });
  const stops = [...byPlot.entries()].map(([ref, v]) => ({ id: ref, label: ref, position: v.position, minutes: 25 + 15 * v.needs.length }));
  const points = [base, ...stops.map((s) => s.position)];
  const matrix = await (deps.fetchMatrix ?? roadMatrix)(points, deps.orsKey);
  await trace.step("tool", "road_matrix", { points: points.length }, { source: matrix ? "openrouteservice" : "estimated" });
  const forecast = await (deps.weather ?? ((p: LonLat) => rainForecast(p)))(base);
  await trace.step("tool", "rain_forecast", { base }, { simulated: forecast.simulated, days: forecast.days });
  // Start tomorrow: today's working hours are usually already planned.
  const result = planVisits({ base, stops, matrix: matrix ?? undefined, days: forecast.days.slice(1) });
  await trace.step("rule", "solve_routes", { stops: stops.length }, { days: result.days.map((d) => ({ date: d.date, stops: d.stops.map((s) => s.id) })), unscheduled: result.unscheduled });

  const stored: StoredPlan = {
    base,
    days: result.days.map((d) => ({ ...d, stopsDetail: d.stops.map((s) => ({ plotRef: s.id, ...byPlot.get(s.id)! })) })),
    unscheduled: result.unscheduled,
    skippedDays: result.skippedDays,
    roads: matrix ? "openrouteservice" : "estimated",
    weather: forecast.simulated ? "simulated" : "open-meteo",
  };
  await db.delete(visitPlans).where(eq(visitPlans.fieldAgentId, agent.id));
  await db.insert(visitPlans).values({ orgId: input.orgId, fieldAgentId: agent.id, plan: stored });
  await recordEvent(db, {
    orgId: input.orgId,
    type: "visits.planned",
    payload: { fieldAgentId: agent.id, days: stored.days.length, plots: stops.length, skippedRain: stored.skippedDays.map((d) => d.date) },
  });
  await trace.finish("succeeded", `${stops.length} visits over ${stored.days.length} day(s) for ${agent.name}`);
  return stored;
}

export async function planAllVisits(deps: VisitDeps, orgId: string) {
  const agents = await deps.db.select({ id: fieldAgents.id }).from(fieldAgents).where(eq(fieldAgents.orgId, orgId));
  let planned = 0;
  for (const a of agents) if (await planAgentVisits(deps, { orgId, fieldAgentId: a.id })) planned++;
  return planned;
}

export async function getVisitPlans(db: Db, orgId: string) {
  const rows = await db.select().from(visitPlans).where(eq(visitPlans.orgId, orgId)).orderBy(desc(visitPlans.createdAt));
  return rows.map((r) => ({ ...r, plan: r.plan as StoredPlan }));
}

/** Sends each registered agent the first day of their plan, within the autonomy settings. */
export async function sendDayPlans(deps: VisitDeps, orgId: string) {
  const { db } = deps;
  const mode = await modeFor(db, orgId, "send_day_plan");
  const plans = await getVisitPlans(db, orgId);
  let sent = 0;
  let notConnected = 0;
  for (const row of plans) {
    const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, row.fieldAgentId));
    const day = row.plan.days[0];
    if (!agent || !day) continue;
    const text = dayPlanText({
      language: agent.language,
      date: day.date,
      stops: day.stopsDetail.map((s) => ({ label: s.plotRef, need: s.needs[0] })),
      travelMinutes: day.travelMinutes,
      skippedRain: row.plan.skippedDays.filter((d) => d.date < day.date).map((d) => d.date),
    });
    if (mode === "off") continue;
    if (mode === "ask") {
      await requestApproval(db, { orgId, kind: "send_day_plan", subjectId: row.id, summary: `Send ${agent.name} the plan for ${day.date}: ${day.stops.length} visits.`, payload: { planId: row.id, text } });
      continue;
    }
    if (!agent.telegramChatId || !deps.telegram) {
      notConnected++;
      continue;
    }
    await deps.telegram.sendMessage(agent.telegramChatId, text);
    await db.insert(messages).values({ orgId, fieldAgentId: agent.id, direction: "out", kind: "day_plan", text, data: { date: day.date, plots: day.stops.map((s) => s.id) } });
    await db.update(visitPlans).set({ sentAt: new Date().toISOString() }).where(eq(visitPlans.id, row.id));
    await recordEvent(db, { orgId, type: "visits.sent", payload: { fieldAgentId: agent.id, date: day.date } });
    sent++;
  }
  return { sent, notConnected, mode };
}
