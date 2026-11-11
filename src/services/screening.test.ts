import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteDb, type Db } from "@/db/client";
import { loadChain } from "@/db/events";
import { agentRuns, agentSteps, checks, gaps, lots, plots } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";
import type { SourceResult } from "@/domain/status";
import type { GfwClient } from "@/integrations/gfw";
import { screenPlot } from "./screening";

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
  await seedDemo(db);
});

/** A satellite source that reports the given loss and alerts for every plot. */
const gfwWith = (lossHa: number, alertCount: number, available = true): GfwClient => ({
  simulated: false,
  treeCoverLoss: async (): Promise<SourceResult> => ({ source: "gfw_loss", available, lossHa, alertCount: 0, datasetVersion: "t" }),
  integratedAlerts: async (): Promise<SourceResult> => ({ source: "gfw_alerts", available, lossHa: 0, alertCount, datasetVersion: "t" }),
});

const plotId = (ref: string) => `plot_${ref}`;

describe("screenPlot", () => {
  it("clears a clean plot, stores each source's check and writes a trace", async () => {
    const r = await screenPlot({ db, gfw: gfwWith(0, 0) }, { orgId: DEMO_ORG_ID, plotId: plotId("KNG-002") });
    expect(r.status).toBe("clear");
    const [p] = await db.select().from(plots).where(eq(plots.id, plotId("KNG-002")));
    expect(p).toMatchObject({ status: "clear", agreement: 1 });
    expect(await db.select().from(checks).where(eq(checks.plotId, plotId("KNG-002")))).toHaveLength(2);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.agent, "geo_analyst"));
    expect(run.status).toBe("succeeded");
    expect((await db.select().from(agentSteps).where(eq(agentSteps.runId, run.id))).length).toBe(2);
  });

  it("blocks a plot with loss, holds its lot, and records both on the ledger", async () => {
    await screenPlot({ db, gfw: gfwWith(0.4, 2) }, { orgId: DEMO_ORG_ID, plotId: plotId("KNG-003") });
    const [lot] = await db.select().from(lots).where(eq(lots.ref, "KNG-L1"));
    expect(lot.state).toBe("held");
    const types = (await loadChain(db, DEMO_ORG_ID)).entries.map((e) => e.type);
    expect(types).toContain("plot.screened");
  });

  it("opens a photo request for a review plot", async () => {
    const r = await screenPlot({ db, gfw: gfwWith(0, 1) }, { orgId: DEMO_ORG_ID, plotId: plotId("KNG-004") });
    expect(r.status).toBe("review");
    const open = await db.select().from(gaps).where(eq(gaps.plotId, plotId("KNG-004")));
    expect(open.map((g) => g.need)).toContain("photo");
  });

  it("leaves a plot not checked when a source is down, and never clears it", async () => {
    const r = await screenPlot({ db, gfw: gfwWith(0, 0, false) }, { orgId: DEMO_ORG_ID, plotId: plotId("KNG-005") });
    expect(r.status).toBe("not_checked");
  });

  it("does not screen a plot whose geometry is invalid", async () => {
    const r = await screenPlot({ db, gfw: gfwWith(0, 0) }, { orgId: DEMO_ORG_ID, plotId: plotId("KNG-015") });
    expect(r.status).toBe("not_checked");
    expect(await db.select().from(checks).where(eq(checks.plotId, plotId("KNG-015")))).toHaveLength(0);
  });
});
