import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createPgliteDb, type Db } from "@/db/client";
import { approvals, farmerAliases, farmers, fieldAgents, flags, gaps, ledgerEntries, lotPlots, lots, messages, plots, questions, shipments } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";
import type { TelegramSender } from "@/integrations/telegram";
import { toIcs } from "@/lib/ics";
import { decide } from "./approvals";
import { setPolicy } from "./autonomy";
import { askQuestion } from "./copilot";
import { clearFlag, getCustody } from "./custody";
import { checkInbox } from "./email-intake";
import { createIntakeBatch } from "./intake";
import { refreshLots } from "./lots";
import { getPlan, proposePlan } from "./planner";
import { planAgentVisits, sendDayPlans } from "./visits";

let db: Db;
const org = DEMO_ORG_ID;
const sent: { chatId: number; text: string }[] = [];
const telegram: TelegramSender = { sendMessage: async (chatId, text) => void sent.push({ chatId, text }) };
const deps = () => ({ db, telegram, mailer: null, gemini: null });
const pending = (kind: string) => db.select().from(approvals).where(and(eq(approvals.orgId, org), eq(approvals.kind, kind), eq(approvals.status, "pending")));

beforeAll(async () => {
  db = await createPgliteDb();
  await seedDemo(db);
});

describe("supply chain auditor", () => {
  it("flags HMB-L4 for an over-delivery and an unmapped supplier, which holds the lot", async () => {
    const c = await getCustody(db, org, "HMB-L4");
    expect(c?.flags.filter((f) => f.status === "open").map((f) => f.kind).sort()).toEqual(["unmapped_supplier", "volume_farmer"]);
    expect(c?.deliveredKg).toBe(9_600);
    expect(c?.lot.state).toBe("held");
    const kinds = new Set(c?.graph.nodes.map((n) => n.kind));
    expect([...kinds].sort()).toEqual(["collector", "lot", "plot", "shipment", "washing_station"]);
  });

  it("finds nothing wrong with a lot whose deliveries its plots could grow", async () => {
    expect((await getCustody(db, org, "KNG-L1"))?.flags).toEqual([]);
  });
});

describe("identity resolution", () => {
  it("proposes merging a farmer written two ways, and merging keeps both spellings", async () => {
    const [proposal] = await pending("merge_farmers");
    expect(proposal.summary).toContain("Abebe Kebbede");
    expect(proposal.summary).toContain("Same phone number");
    const r = await decide(deps(), { orgId: org, id: proposal.id, decision: "approved" });
    expect(r.ok).toBe(true);
    const plotsOfKeeper = await db.select().from(plots).where(inArray(plots.ref, ["KNG-001", "KNG-021"]));
    expect(new Set(plotsOfKeeper.map((p) => p.farmerId)).size).toBe(1);
    expect((await db.select().from(farmerAliases).where(eq(farmerAliases.farmerId, plotsOfKeeper[0].farmerId))).map((a) => a.name)).toContain("Abebe Kebbede");
  });

  it("catches a register row for a farmer already on record in Ge'ez script", async () => {
    const row = (v: unknown) => ({ value: v, confidence: 1 });
    await createIntakeBatch(db, {
      orgId: org,
      cooperativeId: "coop_konga",
      source: "spreadsheet",
      fileName: "second-register.csv",
      rows: [{ farmerName: row("Tesfaie Girma"), village: row("Konga"), phone: row("0911200108"), areaHa: row(1.3), lat: row(6.1012), lon: row(38.219) }] as never,
    });
    const proposals = await pending("merge_farmers");
    expect(proposals.some((p) => p.summary.includes("Tesfaie Girma") && p.summary.includes("ተስፋዬ ግርማ"))).toBe(true);
  });

  it("merges alone above the threshold once the exporter makes merging automatic", async () => {
    await setPolicy(db, { orgId: org, action: "merge_farmers", mode: "auto" });
    const before = (await db.select().from(farmers).where(eq(farmers.orgId, org))).length;
    const row = (v: unknown) => ({ value: v, confidence: 1 });
    await createIntakeBatch(db, {
      orgId: org,
      cooperativeId: "coop_konga",
      source: "spreadsheet",
      fileName: "third-register.csv",
      rows: [{ farmerName: row("Almaz Tadese"), village: row("Konga"), phone: row(null), areaHa: row(0.9), lat: row(6.0991), lon: row(38.2101) }] as never,
    });
    expect((await db.select().from(farmers).where(eq(farmers.orgId, org))).length).toBe(before);
    await setPolicy(db, { orgId: org, action: "merge_farmers", mode: "ask" });
  });

  it("refuses to make a locked action automatic", async () => {
    expect((await setPolicy(db, { orgId: org, action: "release_lot", mode: "auto" })).ok).toBe(false);
  });
});

describe("container planner", () => {
  it("swaps the flagged lot out of its contract for a ready spare, after approval", async () => {
    // Make the two spare lots ready, as if screening had cleared their plots.
    const spare = await db.select().from(lots).where(inArray(lots.ref, ["KNG-L5", "HMB-L6"]));
    const ids = (await db.select().from(lotPlots).where(inArray(lotPlots.lotId, spare.map((l) => l.id)))).map((r) => r.plotId);
    await db.update(plots).set({ status: "clear" }).where(inArray(plots.id, ids));
    await db.update(gaps).set({ status: "resolved" }).where(inArray(gaps.plotId, ids));
    await refreshLots(db, org, ids);

    const view = await getPlan(db, org);
    expect(view.plan.changes.find((c) => c.lotRef === "HMB-L4")?.to).toBeNull();
    const r = await proposePlan(db, org);
    expect(r.message).toMatch(/Proposed/);
    const [proposal] = await pending("change_allocation");
    expect((await decide(deps(), { orgId: org, id: proposal.id, decision: "approved" })).ok).toBe(true);
    const [hmbL4] = await db.select().from(lots).where(eq(lots.ref, "HMB-L4"));
    expect(hmbL4.shipmentId).toBeNull();
    const after = await getPlan(db, org);
    expect(after.plan.changes).toEqual([]);
  });

  it("re-plans with a new contract from email", async () => {
    await checkInbox({ db, gemini: null, gmail: null, query: "" }, org);
    const [contract] = await pending("create_shipment");
    expect(contract.summary).toContain("RHK-2701");
    const r = await decide(deps(), { orgId: org, id: contract.id, decision: "approved" });
    expect(r.message).toContain("Shipment RHK-2701 created");
    expect((await db.select().from(shipments).where(eq(shipments.ref, "RHK-2701")))[0].gradeRequired).toBe("G1");
  });
});

describe("email intake", () => {
  it("drafts a cited reply to a buyer question and ignores injected instructions", async () => {
    const [reply] = await pending("send_reply");
    expect(reply.summary).toContain("Elbe Roasters");
    const q = (await db.select().from(questions).where(eq(questions.channel, "email")))[0];
    expect(q.status).toBe("drafted");
    expect(q.citations.map((c) => c.id)).toContain("art12");
    const lotsReady = await db.select().from(lots).where(eq(lots.state, "ready"));
    expect(lotsReady.map((l) => l.ref).sort()).toEqual(["KNG-L5", "HMB-L6"].sort());
    expect((await checkInbox({ db, gemini: null, gmail: null, query: "" }, org)).processed).toBe(0);
  });
});

describe("regulation copilot", () => {
  it("answers a buyer from the regulation with a citation", async () => {
    const r = await askQuestion({ db, gemini: null }, { orgId: org, channel: "portal", asker: "Elbe Roasters", question: "Do plots above four hectares need a polygon?", shipmentId: "shp_hamburg" });
    expect(r.status).toBe("answered");
    expect(r.citations.map((c) => c.id)).toContain("art2-geolocation");
  });

  it("answers about the buyer's own shipment from stored evidence", async () => {
    const r = await askQuestion({ db, gemini: null }, { orgId: org, channel: "portal", asker: "Elbe Roasters", question: "Is our shipment HAM-2612 deforestation-free?", shipmentId: "shp_hamburg" });
    expect(r.citations.map((c) => c.id)).toEqual(expect.arrayContaining(["E-HAM-2612", "E-KNG-L1"]));
  });

  it("passes an unsupported question to a person, whose note becomes the answer", async () => {
    const r = await askQuestion({ db, gemini: null }, { orgId: org, channel: "portal", asker: "Elbe Roasters", question: "Which espresso grinder do you recommend?", shipmentId: "shp_hamburg" });
    expect(r.status).toBe("needs_person");
    const [ask] = await pending("buyer_question");
    expect((await decide(deps(), { orgId: org, id: ask.id, decision: "approved", reason: "short" })).ok).toBe(false);
    expect((await decide(deps(), { orgId: org, id: ask.id, decision: "approved", reason: "We roast-test every lot but don't advise on equipment." })).ok).toBe(true);
    expect((await db.select().from(questions).where(eq(questions.id, r.id)))[0]).toMatchObject({ status: "answered", mode: "person" });
  });
});

describe("field visit planner", () => {
  it("plans visits around a wet day and sends the first day to a connected agent", async () => {
    await db.update(fieldAgents).set({ telegramChatId: 777 }).where(eq(fieldAgents.id, "fa_dawit"));
    const plan = await planAgentVisits(
      { db, telegram, weather: async () => ({ simulated: true, days: ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map((date, i) => ({ date, precipitationMm: i === 1 ? 30 : 0, precipitationProbability: i === 1 ? 90 : 10 })) }) },
      { orgId: org, fieldAgentId: "fa_dawit" },
    );
    expect(plan?.days[0].date).toBe("2026-11-14");
    expect(plan?.skippedDays.map((d) => d.date)).toEqual(["2026-11-13"]);
    expect(plan?.roads).toBe("estimated");
    const r = await sendDayPlans({ db, telegram }, org);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(sent.at(-1)?.chatId).toBe(777);
    expect((await db.select().from(messages).where(eq(messages.kind, "day_plan"))).length).toBeGreaterThan(0);
    const ics = toIcs(plan!.days.map((d, i) => ({ uid: `${i}@kaffa`, date: d.date, startMinute: 0, minutes: d.totalMinutes, title: "Visits", description: d.stops.map((s) => s.label).join(", ") })));
    expect(ics).toContain("DTSTART:20261114T050000Z");
  });

});

describe("clearing flags", () => {
  it("records the person's reason on the ledger and keeps the flag's history", async () => {
    const [open] = await db.select().from(flags).where(eq(flags.status, "open"));
    const r = await clearFlag(db, { orgId: org, flagId: open.id, reason: "Visited the farm; a second plot is being mapped." });
    expect(r.ok).toBe(true);
    expect((await db.select().from(flags).where(eq(flags.id, open.id)))[0]).toMatchObject({ status: "cleared", reason: expect.stringContaining("second plot") });
    const [last] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.orgId, org)).orderBy(desc(ledgerEntries.seq)).limit(1);
    expect(last).toMatchObject({ type: "flag.cleared", payload: { lotRef: "HMB-L4", by: "exporter" } });
  });
});
