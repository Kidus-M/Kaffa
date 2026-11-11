import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createPgliteDb, type Db } from "@/db/client";
import { approvals, fieldAgents, gaps, messages } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";
import { DAILY_MESSAGE_CAP } from "@/config/policy";
import { escalateChase, sendChase, type ChaseDeps } from "./chase";

let db: Db;
const sent: { chatId: number; text: string }[] = [];
let deps: ChaseDeps;

beforeAll(async () => {
  db = await createPgliteDb();
  await seedDemo(db);
  await db.update(fieldAgents).set({ telegramChatId: 900 }).where(eq(fieldAgents.id, "fa_dawit"));
  deps = { db, gemini: null, appUrl: "https://kaffa.example", telegram: { sendMessage: async (chatId, text) => void sent.push({ chatId, text }) } };
});

const org = DEMO_ORG_ID;

describe("sendChase", () => {
  it("sends one Amharic message naming every open plot, with the Mini App button", async () => {
    const r = await sendChase(deps, { orgId: org, fieldAgentId: "fa_dawit" });
    expect(r).toMatchObject({ sent: true, plotRefs: expect.arrayContaining(["KNG-011", "KNG-015"]) });
    expect(sent.at(-1)!.chatId).toBe(900);
    expect(sent.at(-1)!.text).toContain("KNG-011");
    expect(sent.at(-1)!.text).toContain("ሰላም");
  });

  it("does not message a field agent who has not registered on Telegram", async () => {
    expect(await sendChase(deps, { orgId: org, fieldAgentId: "fa_chaltu" })).toMatchObject({ sent: false, reason: "not_registered" });
  });

  it("stops at the daily message cap", async () => {
    for (let i = 0; i < DAILY_MESSAGE_CAP; i++) await sendChase(deps, { orgId: org, fieldAgentId: "fa_dawit", reminder: true });
    expect(await sendChase(deps, { orgId: org, fieldAgentId: "fa_dawit" })).toMatchObject({ sent: false, reason: "daily_cap" });
  });

  it("counts reminders on the open requests", async () => {
    const open = await db.select().from(gaps).where(and(eq(gaps.fieldAgentId, "fa_dawit"), eq(gaps.status, "open")));
    expect(open.every((g) => g.reminders > 0)).toBe(true);
  });
});

describe("escalateChase", () => {
  it("asks the exporter to step in, keeping the requests open so lots stay held", async () => {
    await escalateChase(deps, { orgId: org, fieldAgentId: "fa_dawit", hours: 96 });
    const [a] = await db.select().from(approvals).where(eq(approvals.kind, "escalation"));
    expect(a.summary).toContain("96 hours");
    const open = await db.select().from(gaps).where(and(eq(gaps.fieldAgentId, "fa_dawit"), eq(gaps.status, "open")));
    expect(open.length).toBeGreaterThan(0);
    const out = await db.select().from(messages).where(eq(messages.fieldAgentId, "fa_dawit"));
    expect(out.length).toBeGreaterThan(0);
  });
});
