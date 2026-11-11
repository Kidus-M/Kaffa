/**
 * Tamper-evident ledger. Each entry's hash covers its content and the previous
 * entry's hash, so editing, inserting or removing any entry breaks the chain.
 * Pure and runtime-agnostic: uses WebCrypto, available in Node, browsers and edge.
 */

export const GENESIS_HASH = "0".repeat(64);

export type LedgerEntry = {
  seq: number;
  orgId: string;
  type: string;
  payload: unknown;
  at: string;
  prevHash: string;
  hash: string;
};

export type LedgerInput = { orgId: string; type: string; payload: unknown; at: string };

/** Deterministic JSON: object keys sorted at every depth, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function hashInput(e: Omit<LedgerEntry, "hash">): Promise<string> {
  const { seq, orgId, type, payload, at, prevHash } = e;
  return sha256Hex(canonicalJson({ seq, orgId, type, payload, at, prevHash }));
}

export async function appendEntry(prev: LedgerEntry | null, input: LedgerInput): Promise<LedgerEntry> {
  const body = {
    seq: (prev?.seq ?? 0) + 1,
    orgId: input.orgId,
    type: input.type,
    payload: input.payload,
    at: input.at,
    prevHash: prev?.hash ?? GENESIS_HASH,
  };
  return { ...body, hash: await hashInput(body) };
}

/** Verifies an ordered chain. `brokenAt` is the seq position (1-based) of the first bad entry. */
export async function verifyChain(
  entries: LedgerEntry[],
): Promise<{ ok: true; head: string } | { ok: false; brokenAt: number }> {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const position = i + 1;
    if (e.seq !== position || e.prevHash !== prevHash) return { ok: false, brokenAt: position };
    if ((await hashInput(e)) !== e.hash) return { ok: false, brokenAt: position };
    prevHash = e.hash;
  }
  return { ok: true, head: prevHash };
}
