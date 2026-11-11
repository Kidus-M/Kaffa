import { describe, expect, it } from "vitest";
import { GENESIS_HASH, appendEntry, canonicalJson, verifyChain, type LedgerEntry } from "./ledger";

const at = "2026-11-11T08:00:00.000Z";

async function chainOf(n: number): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await appendEntry(out.at(-1) ?? null, { orgId: "org1", type: "plot.status_changed", payload: { i }, at }));
  }
  return out;
}

describe("canonicalJson", () => {
  it("is independent of key order, at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("ledger", () => {
  it("starts a chain from the genesis hash", async () => {
    const [first] = await chainOf(1);
    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("links each entry to the previous hash", async () => {
    const chain = await chainOf(3);
    expect(chain[1].prevHash).toBe(chain[0].hash);
    expect(chain[2].seq).toBe(3);
    expect(await verifyChain(chain)).toEqual({ ok: true, head: chain[2].hash });
  });

  it("detects an edited payload", async () => {
    const chain = await chainOf(3);
    chain[1] = { ...chain[1], payload: { i: 99 } };
    expect(await verifyChain(chain)).toEqual({ ok: false, brokenAt: 2 });
  });

  it("detects a removed entry", async () => {
    const chain = await chainOf(3);
    expect(await verifyChain([chain[0], chain[2]])).toEqual({ ok: false, brokenAt: 2 });
  });

  it("treats an empty chain as valid with the genesis head", async () => {
    expect(await verifyChain([])).toEqual({ ok: true, head: GENESIS_HASH });
  });
});
