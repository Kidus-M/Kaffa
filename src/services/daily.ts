/**
 * The morning run without Inngest: the same work as the durable daily workflow, done in
 * one request. Used by the cron endpoint when Inngest is not configured, so a plain
 * Vercel deployment still re-screens, chases, audits, plans and briefs every morning.
 */
import { and, eq, sql } from "drizzle-orm";
import { recordEvent } from "@/db/events";
import { gaps, orgs, plots } from "@/db/schema";
import { computeBrief } from "./brief";
import { sendChase } from "./chase";
import { auditLots } from "./custody";
import type { getAppDeps } from "./deps";
import { checkInbox } from "./email-intake";
import { proposePlan } from "./planner";
import { screenPlot } from "./screening";
import { planAllVisits, sendDayPlans } from "./visits";

type Deps = Awaited<ReturnType<typeof getAppDeps>>;

/** Runs one step, recording a failure instead of stopping the rest of the morning. */
async function attempt(name: string, failures: string[], fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function runDailyInline(deps: Deps) {
  const { db } = deps;
  const allOrgs = await db.select({ id: orgs.id }).from(orgs);
  const summary: Record<string, { rescreened: number; chased: number; failures: string[] }> = {};

  for (const { id: orgId } of allOrgs) {
    const failures: string[] = [];
    const rescreen = await db
      .select({ id: plots.id })
      .from(plots)
      .where(
        sql`${plots.orgId} = ${orgId} and ${plots.status} in ('clear', 'review', 'not_checked') and not exists (select 1 from jsonb_array_elements(${plots.issues}) i where i->>'severity' = 'error')`,
      );
    await attempt("screen", failures, async () => {
      for (let i = 0; i < rescreen.length; i += 6)
        await Promise.all(rescreen.slice(i, i + 6).map((p) => screenPlot({ db, gfw: deps.gfw }, { orgId, plotId: p.id })));
    });

    let chased = 0;
    await attempt("chase", failures, async () => {
      const agents = await db.selectDistinct({ fieldAgentId: gaps.fieldAgentId }).from(gaps).where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open")));
      for (const a of agents) if ((await sendChase(deps, { orgId, fieldAgentId: a.fieldAgentId })).sent) chased++;
    });
    await attempt("audit", failures, () => auditLots(db, orgId));
    await attempt("inbox", failures, () => checkInbox({ ...deps, query: deps.gmailQuery }, orgId));
    await attempt("visits", failures, async () => {
      await planAllVisits(deps, orgId);
      await sendDayPlans(deps, orgId);
    });
    await attempt("planner", failures, () => proposePlan(db, orgId));

    const [{ open }] = await db.select({ open: sql<number>`count(*)::int` }).from(gaps).where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open")));
    const brief = await computeBrief(db, orgId);
    await recordEvent(db, {
      orgId,
      type: "daily.ran",
      payload: { rescreened: rescreen.length, openRequests: open, chased, brief: brief.map((b) => b.title), mode: "inline", failures },
    });
    summary[orgId] = { rescreened: rescreen.length, chased, failures };
  }
  return summary;
}
