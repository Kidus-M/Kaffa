import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { fieldAgents, visitPlans } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { toIcs } from "@/lib/ics";
import type { StoredPlan } from "@/services/visits";

/** A field agent's visit plan as a calendar file. Console-only data, like the console itself (Tier 1 has no sign-in). */
export async function GET(_req: Request, ctx: RouteContext<"/api/visits/[agent]/calendar">) {
  const { agent } = await ctx.params;
  const db = await getDb();
  const [a] = await db.select().from(fieldAgents).where(and(eq(fieldAgents.id, agent), eq(fieldAgents.orgId, DEMO_ORG_ID)));
  const [row] = await db.select().from(visitPlans).where(eq(visitPlans.fieldAgentId, agent)).orderBy(desc(visitPlans.createdAt)).limit(1);
  if (!a || !row) return Response.json({ error: "no plan" }, { status: 404 });
  const plan = row.plan as StoredPlan;
  const ics = toIcs(
    plan.days.map((d) => ({
      uid: `${row.id}-${d.date}@kaffa`,
      date: d.date,
      startMinute: 0,
      minutes: d.totalMinutes,
      title: `Farm visits: ${d.stops.length} plots`,
      description: d.stopsDetail.map((s, i) => `${i + 1}. ${s.plotRef}: ${s.needs.join(", ")}`).join("\n"),
    })),
  );
  return new Response(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="visits-${agent}.ics"` },
  });
}
