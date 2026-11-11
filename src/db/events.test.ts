import { beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "./client";
import { loadChain, recordEvent } from "./events";

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
});

describe("recordEvent", () => {
  it("chains events per organisation and the stored chain verifies", async () => {
    const first = await recordEvent(db, { orgId: "org-a", type: "plot.screened", payload: { plotId: "p1", status: "clear" } });
    const second = await recordEvent(db, { orgId: "org-a", type: "lot.held", payload: { lotId: "l1" } });
    const other = await recordEvent(db, { orgId: "org-b", type: "plot.screened", payload: { plotId: "p9" } });

    expect(second.prevHash).toBe(first.hash);
    expect(second.seq).toBe(2);
    expect(other.seq).toBe(1);

    const chain = await loadChain(db, "org-a");
    expect(chain.verification).toEqual({ ok: true, head: second.hash });
  });

  it("serialises concurrent writers into one unbroken chain", async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => recordEvent(db, { orgId: "org-c", type: "gap.opened", payload: { i } })),
    );
    const chain = await loadChain(db, "org-c");
    expect(chain.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(chain.verification.ok).toBe(true);
  });
});
