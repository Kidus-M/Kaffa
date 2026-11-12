import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteDb, type Db } from "./client";
import { loadChain } from "./events";
import { gaps, plots } from "./schema";
import { DEMO_ORG_ID } from "./seed-data";
import { seedDemo } from "./seed";

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
  await seedDemo(db);
});

describe("seedDemo", () => {
  it("creates 52 synthetic plots validated by the real rules", async () => {
    const rows = await db.select().from(plots).where(eq(plots.orgId, DEMO_ORG_ID));
    expect(rows).toHaveLength(52);
    expect(rows.every((p) => p.synthetic)).toBe(true);
    const codesOf = (ref: string) => rows.find((p) => p.ref === ref)!.issues.map((i) => i.code);
    expect(codesOf("KNG-007")).toContain("swapped_coordinates");
    expect(codesOf("KNG-011")).toContain("polygon_required");
    expect(codesOf("KNG-015")).toContain("self_intersection");
  });

  it("repairs the unclosed boundary instead of asking the field", async () => {
    const [row] = await db.select().from(plots).where(eq(plots.ref, "HMB-012"));
    expect(row.issues.some((i) => i.severity === "error")).toBe(false);
  });

  it("opens one field request per problem plot, assigned to the right field agent", async () => {
    const open = await db.select().from(gaps).where(eq(gaps.status, "open"));
    const byPlot = Object.fromEntries(
      await Promise.all(
        open.map(async (g) => {
          const [p] = await db.select().from(plots).where(eq(plots.id, g.plotId));
          return [p.ref, g] as const;
        }),
      ),
    );
    expect(byPlot["KNG-007"]).toMatchObject({ need: "confirm", fieldAgentId: "fa_tigist" });
    expect(byPlot["KNG-011"]).toMatchObject({ need: "boundary", fieldAgentId: "fa_dawit" });
    expect(byPlot["KNG-015"]).toMatchObject({ need: "boundary" });
    expect(byPlot["HMB-005"] ?? byPlot["HMB-004"]).toMatchObject({ need: "boundary", reason: "overlap", fieldAgentId: "fa_chaltu" });
  });

  it("is idempotent and leaves a verifiable ledger", async () => {
    await seedDemo(db);
    expect(await db.select().from(plots).where(eq(plots.orgId, DEMO_ORG_ID))).toHaveLength(52);
    expect((await loadChain(db, DEMO_ORG_ID)).verification.ok).toBe(true);
  });
});
