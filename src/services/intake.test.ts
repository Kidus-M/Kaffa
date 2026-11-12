import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { createPgliteDb, type Db } from "@/db/client";
import { loadChain } from "@/db/events";
import { agentRuns, farmers, gaps, intakeRows, plots } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";
import type { IntakeRow } from "@/agents/intake";
import { createIntakeBatch, resolveIntakeRow } from "./intake";

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
  await seedDemo(db);
});

const f = <T,>(value: T, confidence = 1) => ({ value, confidence });
const row = (over: Partial<IntakeRow> = {}): IntakeRow => ({
  farmerName: f("Mekdes Worku"),
  village: f("Konga"),
  phone: f(null),
  areaHa: f(1.1),
  lat: f(6.104321),
  lon: f(38.214321),
  ...over,
});

describe("createIntakeBatch", () => {
  it("creates plots for confident rows, flags bad ones, and queues uncertain ones", async () => {
    const r = await createIntakeBatch(db, {
      orgId: DEMO_ORG_ID,
      cooperativeId: "coop_konga",
      source: "spreadsheet",
      fileName: "konga-register.xlsx",
      rows: [
        row(),
        row({ farmerName: f("ተስፋዬ ግርማ"), lat: f(38.215432), lon: f(6.105432) }),
        row({ farmerName: f("Hirut Bekele"), lat: f(6.1, 0.55) }),
      ],
    });
    expect(r).toMatchObject({ created: 2, review: 1 });
    expect(r.createdRefs).toEqual(["KNG-027", "KNG-028"]);
    expect(r.screenable).toHaveLength(1);

    const [p] = await db.select().from(plots).where(eq(plots.ref, "KNG-028"));
    expect(p.issues.map((i) => i.code)).toContain("swapped_coordinates");
    expect(p.fieldAgentId).toBeTruthy();
    expect((await db.select().from(gaps).where(and(eq(gaps.plotId, p.id), eq(gaps.status, "open"))))[0].need).toBe("confirm");

    const [farmer] = await db.select().from(farmers).where(eq(farmers.id, p.farmerId));
    expect(farmer.name).toBe("ተስፋዬ ግርማ");
    expect(farmer.nameLatin).toBeNull();

    const pending = await db.select().from(intakeRows).where(eq(intakeRows.status, "pending"));
    expect(pending).toHaveLength(1);
    expect(pending[0].reviewFields).toEqual(["lat"]);

    expect((await loadChain(db, DEMO_ORG_ID)).entries.map((e) => e.type)).toContain("intake.batch_received");
    expect((await db.select().from(agentRuns).where(eq(agentRuns.agent, "intake"))).length).toBe(1);
  });
});

describe("resolveIntakeRow", () => {
  it("turns a corrected row into a plot, and refuses a correction that is still incomplete", async () => {
    const [pending] = await db.select().from(intakeRows).where(eq(intakeRows.status, "pending"));
    const bad = await resolveIntakeRow(db, { orgId: DEMO_ORG_ID, rowId: pending.id, decision: "accept", values: { lat: null } });
    expect(bad).toMatchObject({ ok: false });

    const good = await resolveIntakeRow(db, { orgId: DEMO_ORG_ID, rowId: pending.id, decision: "accept", values: { lat: 6.106543 } });
    expect(good).toMatchObject({ ok: true, plotRef: "KNG-029" });
    expect((await db.select().from(intakeRows).where(eq(intakeRows.id, pending.id)))[0].status).toBe("accepted");
    expect(await db.select().from(plots).where(like(plots.ref, "KNG-02%"))).toHaveLength(10);
  });

  it("can reject a row without creating anything", async () => {
    const r = await createIntakeBatch(db, {
      orgId: DEMO_ORG_ID,
      cooperativeId: "coop_hambela",
      source: "photo",
      fileName: "page-3.jpg",
      rows: [row({ farmerName: f("", 0) })],
    });
    expect(r.review).toBe(1);
    const [pending] = await db.select().from(intakeRows).where(eq(intakeRows.status, "pending"));
    expect(await resolveIntakeRow(db, { orgId: DEMO_ORG_ID, rowId: pending.id, decision: "reject" })).toMatchObject({ ok: true });
    expect((await db.select().from(intakeRows).where(eq(intakeRows.id, pending.id)))[0].status).toBe("rejected");
  });
});
