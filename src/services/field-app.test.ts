import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createPgliteDb, type Db } from "@/db/client";
import { fieldAgents, gaps, plots } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { demoModeEnabled, fieldTasks, resolveFieldAgent, submitWalk } from "./field-app";

let db: Db;
const events: { name: string }[] = [];
beforeAll(async () => {
  db = await createPgliteDb();
  await seedDemo(db);
});

const emit = async (e: { name: string; data: Record<string, unknown> }) => void events.push(e);

/** Walk a square of `sideM` metres around a centre, five fixes per side. */
function walk([lon, lat]: [number, number], sideM: number) {
  const dLat = sideM / 111_320;
  const dLon = sideM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  return corners.flatMap(([x, y], i) => {
    const [nx, ny] = corners[(i + 1) % 4];
    return Array.from({ length: 5 }, (_, s) => ({
      lon: lon + (x + ((nx - x) * s) / 5) * dLon,
      lat: lat + (y + ((ny - y) * s) / 5) * dLat,
      accuracyM: 6,
      t: i * 5 + s,
    }));
  });
}

describe("resolveFieldAgent", () => {
  it("allows the demo picker only when demo mode is on and no bot token is configured", async () => {
    expect((await resolveFieldAgent(db, { demoAgentId: "fa_dawit" }, { botToken: undefined, demoMode: true }))?.id).toBe("fa_dawit");
    expect(await resolveFieldAgent(db, { demoAgentId: "fa_dawit" }, { botToken: "123:token", demoMode: true })).toBeNull();
  });

  it("fails closed when demo mode is off, even without a bot token", async () => {
    expect(await resolveFieldAgent(db, { demoAgentId: "fa_dawit" }, { botToken: undefined, demoMode: false })).toBeNull();
  });

  it("never lets the demo picker reach a real, non-synthetic field agent", async () => {
    await db.insert(fieldAgents).values({ id: "fa_real", orgId: "org_real", cooperativeId: "c", name: "Real Agent", registrationToken: "real-token", synthetic: false });
    expect(await resolveFieldAgent(db, { demoAgentId: "fa_real" }, { botToken: undefined, demoMode: true })).toBeNull();
  });

  it("rejects missing or forged init data when a bot token is configured", async () => {
    expect(await resolveFieldAgent(db, { initData: "hash=00&auth_date=1" }, { botToken: "123:token", demoMode: false })).toBeNull();
  });
});

describe("demoModeEnabled", () => {
  it("is on in development, and in production only with DEMO_MODE=1", () => {
    expect(demoModeEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(demoModeEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(demoModeEnabled({ NODE_ENV: "production", DEMO_MODE: "1" })).toBe(true);
  });
});

describe("submitWalk", () => {
  it("lists the field agent's open tasks with a place to start walking", async () => {
    const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, "fa_dawit"));
    const tasks = await fieldTasks(db, agent);
    expect(tasks.find((t) => t.plotRef === "KNG-011")).toMatchObject({ need: "boundary", start: expect.any(Array) });
  });

  it("turns a walked boundary into a valid polygon and closes the request", async () => {
    const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, "fa_dawit"));
    const task = (await fieldTasks(db, agent)).find((t) => t.plotRef === "KNG-011")!;
    const r = await submitWalk({ db, emit }, agent, { plotRef: "KNG-011", points: walk(task.start!, 240), simulated: true });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.areaHa).toBeGreaterThan(5);

    const [plot] = await db.select().from(plots).where(eq(plots.ref, "KNG-011"));
    expect(plot.geometry?.type).toBe("Polygon");
    expect(plot.issues.some((i) => i.severity === "error")).toBe(false);
    const open = await db.select().from(gaps).where(and(eq(gaps.plotId, plot.id), eq(gaps.status, "open")));
    expect(open).toHaveLength(0);
    expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(["kaffa/plot.screen.requested", "kaffa/field.replied"]));
  });

  it("refuses a plot that is not one of the field agent's tasks", async () => {
    const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, "fa_dawit"));
    expect(await submitWalk({ db, emit }, agent, { plotRef: "HMB-005", points: walk([38.75, 5.87], 100) })).toEqual({
      ok: false,
      reason: "not_your_task",
    });
  });

  it("asks for a re-walk when the track is too short", async () => {
    const [agent] = await db.select().from(fieldAgents).where(eq(fieldAgents.id, "fa_dawit"));
    const r = await submitWalk({ db, emit }, agent, { plotRef: "KNG-015", points: walk([38.2, 6.1], 100).slice(0, 2) });
    expect(r).toEqual({ ok: false, reason: "too_few_points" });
  });
});
