import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createPgliteDb, type Db } from "@/db/client";
import { fieldAgents, gaps, messages, plots } from "@/db/schema";
import { buildSeedPlots } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";
import type { Inbound } from "@/integrations/telegram";
import { handleInbound, type InboundDeps } from "./field-inbound";

let db: Db;
const sent: { chatId: number; text: string }[] = [];
const events: { name: string; data: Record<string, unknown> }[] = [];
let deps: InboundDeps;

beforeAll(async () => {
  db = await createPgliteDb();
  await seedDemo(db);
  deps = {
    db,
    gemini: null,
    appUrl: "https://kaffa.example",
    telegram: { sendMessage: async (chatId, text) => void sent.push({ chatId, text }) },
    emit: async (e) => void events.push(e),
  };
});

const msg = (over: Partial<Inbound>): Inbound => ({ updateId: Math.floor(Math.random() * 1e9), chatId: 555, fromId: 555, kind: "text", ...over });

describe("handleInbound", () => {
  it("registers a field agent from their start link, once", async () => {
    const start = msg({ updateId: 1001, kind: "start", startPayload: "fa-tigist-7d1c" });
    expect(await handleInbound(start, deps)).toEqual({ status: "registered", fieldAgentId: "fa_tigist" });
    const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, "fa_tigist"));
    expect(agent.telegramChatId).toBe(555);
    expect(sent.at(-1)?.chatId).toBe(555);

    expect(await handleInbound(start, deps)).toEqual({ status: "duplicate" });
  });

  it("refuses an unknown start link and an unregistered chat", async () => {
    expect(await handleInbound(msg({ chatId: 777, kind: "start", startPayload: "forged" }), deps)).toEqual({ status: "unknown_sender" });
    expect(await handleInbound(msg({ chatId: 777, text: "hello" }), deps)).toEqual({ status: "unknown_sender" });
  });

  it("applies a shared location to the plot waiting for it and asks for re-screening", async () => {
    const truth = buildSeedPlots().find((p) => p.ref === "KNG-007")!.geometry as { coordinates: number[] };
    const [lat, lon] = truth.coordinates; // seeded swapped: [lat, lon]
    const r = await handleInbound(msg({ kind: "location", location: { lat, lon } }), deps);
    expect(r).toMatchObject({ status: "handled", intent: "location", plotRefs: ["KNG-007"] });

    const [plot] = await db.select().from(plots).where(eq(plots.ref, "KNG-007"));
    expect(plot.issues.some((i) => i.code === "swapped_coordinates")).toBe(false);
    const open = await db.select().from(gaps).where(and(eq(gaps.plotId, plot.id), eq(gaps.status, "open")));
    expect(open).toHaveLength(0);
    expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(["kaffa/field.replied", "kaffa/plot.screen.requested"]));
  });

  it("stores every inbound and outbound message for the console", async () => {
    const rows = await db.select().from(messages).where(eq(messages.fieldAgentId, "fa_tigist"));
    expect(rows.some((m) => m.direction === "in" && m.kind === "location")).toBe(true);
    expect(rows.some((m) => m.direction === "out")).toBe(true);
  });
});
