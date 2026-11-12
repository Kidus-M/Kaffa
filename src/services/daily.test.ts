import { describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { createPgliteDb } from "@/db/client";
import { ledgerEntries, plots } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";
import { createGfwClient } from "@/integrations/gfw";
import { simulatedForecast } from "@/integrations/weather";
import { runDailyInline } from "./daily";

describe("runDailyInline", () => {
  it("does the morning's work without Inngest and records the brief", async () => {
    const db = await createPgliteDb();
    await seedDemo(db);
    const deps = {
      db,
      gfw: createGfwClient({}),
      gemini: null,
      telegram: null,
      mailer: null,
      gmail: null,
      gmailQuery: "",
      orsKey: undefined,
      weather: async () => simulatedForecast(),
    } as unknown as Parameters<typeof runDailyInline>[0];

    const summary = await runDailyInline(deps);
    expect(summary[DEMO_ORG_ID].failures).toEqual([]);
    expect(summary[DEMO_ORG_ID].rescreened).toBeGreaterThan(40);
    expect((await db.select().from(plots).where(eq(plots.status, "not_checked"))).length).toBeLessThan(10);
    const [last] = await db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.seq)).limit(1);
    expect(last).toMatchObject({ type: "daily.ran", payload: { mode: "inline" } });
  });
});
