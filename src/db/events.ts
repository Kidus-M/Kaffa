/**
 * Every state change is recorded here, on the tamper-evident ledger. The ledger is
 * also the outbox: workflows and the live activity feed read from it.
 */
import { asc, desc, eq } from "drizzle-orm";
import { appendEntry, verifyChain, type LedgerEntry } from "@/domain/ledger";
import type { Db } from "./client";
import { ledgerEntries } from "./schema";

const MAX_ATTEMPTS = 10;

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

export async function recordEvent(
  db: Db,
  input: { orgId: string; type: string; payload: unknown; at?: string },
): Promise<LedgerEntry> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [last] = await tx
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.orgId, input.orgId))
          .orderBy(desc(ledgerEntries.seq))
          .limit(1);
        const entry = await appendEntry(last ?? null, {
          orgId: input.orgId,
          type: input.type,
          payload: input.payload,
          at: input.at ?? new Date().toISOString(),
        });
        await tx.insert(ledgerEntries).values(entry);
        return entry;
      });
    } catch (e) {
      // Two writers took the same seq: the primary key rejected one. Retry on the new head.
      if (attempt < MAX_ATTEMPTS && isUniqueViolation(e)) {
        await new Promise((r) => setTimeout(r, Math.random() * 20 * attempt));
        continue;
      }
      throw e;
    }
  }
}

export async function loadChain(db: Db, orgId: string) {
  const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.orgId, orgId)).orderBy(asc(ledgerEntries.seq));
  const entries: LedgerEntry[] = rows.map((r) => ({ ...r }));
  return { entries, verification: await verifyChain(entries) };
}
