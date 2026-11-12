/**
 * Durable workflows. A chase waits days for a reply without using compute, and
 * survives restarts and deployments, because each step's result is persisted.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { recordEvent } from "@/db/events";
import { gaps, orgs, plots } from "@/db/schema";
import { computeBrief } from "@/services/brief";
import { escalateChase, sendChase } from "@/services/chase";
import { auditLots } from "@/services/custody";
import { checkInbox } from "@/services/email-intake";
import { proposePlan } from "@/services/planner";
import { planAllVisits, sendDayPlans } from "@/services/visits";
import { getAppDeps } from "@/services/deps";
import { screenPlot } from "@/services/screening";
import { runChase, type StepRunner } from "./chase-flow";
import { inngest } from "./client";
import { EVENTS } from "./events";

const plotEvent = z.object({ orgId: z.string(), plotId: z.string() });
const chaseEvent = z.object({ orgId: z.string(), fieldAgentId: z.string() });

export const screenPlotFn = inngest.createFunction(
  { id: "screen-plot", triggers: [{ event: EVENTS.plotScreenRequested }], concurrency: { limit: 5 }, retries: 3 },
  async ({ event, step }) => {
    const data = plotEvent.parse(event.data);
    return step.run("screen", async () => {
      const { db, gfw } = await getAppDeps();
      return screenPlot({ db, gfw }, data);
    });
  },
);

export const chaseFieldAgentFn = inngest.createFunction(
  {
    id: "chase-field-agent",
    triggers: [{ event: EVENTS.chaseRequested }],
    // One chase per field agent: while one is running, new requests (such as the daily run's) are skipped.
    singleton: { key: "event.data.fieldAgentId", mode: "skip" },
  },
  async ({ event, step }) => {
    const data = chaseEvent.parse(event.data);
    return runChase(step as unknown as StepRunner, {
      send: async (reminder) => sendChase(await getAppDeps(), { ...data, reminder }),
      escalate: async (hours) => escalateChase(await getAppDeps(), { ...data, hours }),
    });
  },
);

/** The morning run: re-screen plots, chase whoever has open requests, write the brief. */
export const dailyRunFn = inngest.createFunction(
  { id: "daily-run", triggers: [{ event: EVENTS.dailyRequested }] },
  async ({ step }) => {
    const plan = await step.run("plan", async () => {
      const { db } = await getAppDeps();
      const allOrgs = await db.select({ id: orgs.id }).from(orgs);
      const rescreen = await db
        .select({ orgId: plots.orgId, plotId: plots.id })
        .from(plots)
        .where(sql`${plots.status} in ('clear', 'review', 'not_checked') and not exists (select 1 from jsonb_array_elements(${plots.issues}) i where i->>'severity' = 'error')`);
      const chase = await db
        .selectDistinct({ orgId: gaps.orgId, fieldAgentId: gaps.fieldAgentId })
        .from(gaps)
        .where(eq(gaps.status, "open"));
      return { orgIds: allOrgs.map((o) => o.id), rescreen, chase };
    });

    if (plan.rescreen.length) {
      await step.sendEvent("rescreen-plots", plan.rescreen.map((data) => ({ name: EVENTS.plotScreenRequested, data })));
    }
    if (plan.chase.length) {
      await step.sendEvent("chase-field-agents", plan.chase.map((data) => ({ name: EVENTS.chaseRequested, data })));
    }
    // The other agents' daily work, one durable step each so a failure retries only that step.
    await step.run("audit-volumes", async () => {
      const { db } = await getAppDeps();
      for (const orgId of plan.orgIds) await auditLots(db, orgId);
    });
    await step.run("read-inbox", async () => {
      const deps = await getAppDeps();
      for (const orgId of plan.orgIds) await checkInbox({ ...deps, query: deps.gmailQuery }, orgId);
    });
    await step.run("plan-visits", async () => {
      const deps = await getAppDeps();
      for (const orgId of plan.orgIds) {
        await planAllVisits(deps, orgId);
        await sendDayPlans(deps, orgId);
      }
    });
    await step.run("plan-containers", async () => {
      const { db } = await getAppDeps();
      for (const orgId of plan.orgIds) await proposePlan(db, orgId);
    });
    await step.run("brief", async () => {
      const { db } = await getAppDeps();
      for (const orgId of plan.orgIds) {
        const brief = await computeBrief(db, orgId);
        const [{ open }] = await db
          .select({ open: sql<number>`count(*)::int` })
          .from(gaps)
          .where(and(eq(gaps.orgId, orgId), eq(gaps.status, "open")));
        await recordEvent(db, {
          orgId,
          type: "daily.ran",
          payload: { rescreened: plan.rescreen.filter((p) => p.orgId === orgId).length, openRequests: open, brief: brief.map((b) => b.title) },
        });
      }
    });
    return { rescreened: plan.rescreen.length, chased: plan.chase.length };
  },
);

export const functions = [screenPlotFn, chaseFieldAgentFn, dailyRunFn];
