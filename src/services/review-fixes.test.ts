import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { createPgliteDb, type Db } from "@/db/client";
import { fieldAgents, gaps, lotPlots, lots, plots } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";
import type { SourceResult } from "@/domain/status";
import type { GfwClient } from "@/integrations/gfw";
import { handleInbound, type InboundDeps } from "./field-inbound";
import { exportLot } from "./lot-export";
import { refreshLots } from "./lots";
import { acceptReviewPlot, recapturePlot, removePlotFromLot } from "./plots";
import { screenPlot } from "./screening";

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
  await seedDemo(db);
});
const org = DEMO_ORG_ID;
const gfwWith = (lossHa: number, alertCount: number): GfwClient => ({
  simulated: false,
  treeCoverLoss: async (): Promise<SourceResult> => ({ source: "gfw_loss", available: true, lossHa, alertCount: 0, datasetVersion: "t" }),
  integratedAlerts: async (): Promise<SourceResult> => ({ source: "gfw_alerts", available: true, lossHa: 0, alertCount, datasetVersion: "t" }),
});
const openGaps = async (plotId: string) => db.select().from(gaps).where(and(eq(gaps.plotId, plotId), eq(gaps.status, "open")));

describe("accepted reviews stay accepted", () => {
  it("accepting a review closes its photo request, and re-screening does not reopen it", async () => {
    await screenPlot({ db, gfw: gfwWith(0, 1) }, { orgId: org, plotId: "plot_KNG-004" });
    expect((await openGaps("plot_KNG-004")).map((g) => g.need)).toContain("photo");

    await acceptReviewPlot(db, { orgId: org, plotRef: "KNG-004", reason: "Field photo shows mature shade trees over coffee." });
    expect(await openGaps("plot_KNG-004")).toHaveLength(0);

    await screenPlot({ db, gfw: gfwWith(0, 1) }, { orgId: org, plotId: "plot_KNG-004" });
    expect(await openGaps("plot_KNG-004")).toHaveLength(0);
    const [p] = await db.select().from(plots).where(eq(plots.id, "plot_KNG-004"));
    expect(p.reviewAccepted).toBe(true);
  });
});

describe("re-walked boundaries are checked for overlaps", () => {
  it("keeps the overlap request open when the new boundary still overlaps a neighbour", async () => {
    const [b] = await db.select().from(plots).where(eq(plots.id, "plot_HMB-005"));
    const r = await recapturePlot(db, { orgId: org, plotId: b.id, geometry: b.geometry!, source: "mini_app_walk", fieldAgentId: "fa_chaltu" });
    expect(r.overlaps.length).toBeGreaterThan(0);
    expect((await openGaps(b.id)).map((g) => g.reason)).toContain("overlap");
  });
});

describe("field inbound failures can be retried", () => {
  it("does not mark an update as seen when processing fails", async () => {
    await db.update(fieldAgents).set({ telegramChatId: 4040 }).where(eq(fieldAgents.id, "fa_tigist"));
    const failing: InboundDeps = {
      db,
      telegram: null,
      appUrl: "https://kaffa.example",
      emit: async () => {},
      gemini: {
        generateJson: async () => {
          throw new Error("network down");
        },
      },
    };
    const msg = { updateId: 9001, chatId: 4040, fromId: 4040, kind: "text" as const, text: "about KNG-007" };
    await expect(handleInbound(msg, failing)).rejects.toThrow();
    expect((await handleInbound(msg, { ...failing, gemini: null })).status).toBe("handled");
  });

  it("uses up a registration link, so it cannot be replayed from another account", async () => {
    const deps: InboundDeps = { db, telegram: null, gemini: null, appUrl: "https://kaffa.example", emit: async () => {} };
    expect((await handleInbound({ updateId: 9101, chatId: 5050, fromId: 5050, kind: "start", startPayload: "fa-chaltu-5a2f" }, deps)).status).toBe("registered");
    expect((await handleInbound({ updateId: 9102, chatId: 6060, fromId: 6060, kind: "start", startPayload: "fa-chaltu-5a2f" }, deps)).status).toBe("unknown_sender");
    const [a] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, "fa_chaltu"));
    expect(a.telegramChatId).toBe(5050);
  });
});

describe("exports", () => {
  it("refuses a held lot, and exports a ready lot completely", async () => {
    expect(await exportLot(db, { lotRef: "KNG-L1", token: "portal-elbe-4f8a2c" })).toMatchObject({ ready: false });

    const [lot] = await db.select().from(lots).where(eq(lots.ref, "HMB-L4"));
    const ids = (await db.select().from(lotPlots).where(eq(lotPlots.lotId, lot.id))).map((r) => r.plotId);
    await db.update(plots).set({ status: "clear" }).where(inArray(plots.id, ids));
    await db.update(gaps).set({ status: "resolved" }).where(inArray(gaps.plotId, ids));
    await refreshLots(db, org, ids);

    const ready = await exportLot(db, { lotRef: "HMB-L4", token: "portal-scheldt-9b1d7e" });
    expect(ready).toMatchObject({ ready: true, rejected: [] });
    if (ready?.ready) expect(ready.files[0].features).toHaveLength(ids.length);
  });

  it("lets the exporter remove a blocked plot from its lot, on the ledger", async () => {
    await db.update(plots).set({ status: "blocked" }).where(eq(plots.id, "plot_HMB-013"));
    await refreshLots(db, org, ["plot_HMB-013"]);
    expect((await db.select().from(lots).where(eq(lots.ref, "HMB-L4")))[0].state).toBe("held");

    await removePlotFromLot(db, { orgId: org, plotRef: "HMB-013", reason: "Plot cleared in 2023; excluded from this contract." });
    expect((await db.select().from(lots).where(eq(lots.ref, "HMB-L4")))[0].state).toBe("ready");
  });
});
