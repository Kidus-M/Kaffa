import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { approvals } from "@/db/schema";
import { consoleContext } from "@/lib/console";
import { decideApproval } from "../actions";

export const metadata = { title: "Approvals" };

const KIND_TEXT: Record<string, string> = {
  escalation: "A field agent has not replied",
  review_photo: "A field photo arrived for a review plot",
};

export default function ApprovalsPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
        <p className="mt-2 text-ink-soft">
          Agents ask before anything with legal or commercial weight. Every decision and its reason goes on the ledger.
        </p>
      </header>
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <ApprovalList />
      </Suspense>
    </div>
  );
}

async function ApprovalList() {
  const { db, orgId } = await consoleContext();
  const rows = await db.select().from(approvals).where(eq(approvals.orgId, orgId)).orderBy(desc(approvals.createdAt)).limit(50);
  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");
  return (
    <>
      {pending.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule p-6 text-ink-soft">
          Nothing is waiting for you. Escalations and field photos appear here when agents need a decision.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {pending.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-5">
              <p className="font-medium">{KIND_TEXT[a.kind] ?? a.kind}</p>
              <p className="text-ink-soft">{a.summary}</p>
              <form action={decideApproval} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <input type="hidden" name="id" value={a.id} />
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  Note for the ledger (optional)
                  <input name="reason" className="rounded-md border border-rule bg-white p-2" />
                </label>
                <div className="flex gap-2">
                  <button name="decision" value="approved" className="rounded-md bg-canopy px-4 py-2 text-sm font-semibold text-white hover:bg-ink">
                    Approve
                  </button>
                  <button name="decision" value="rejected" className="rounded-md border border-rule px-4 py-2 text-sm font-semibold hover:bg-white">
                    Reject
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
      {decided.length ? (
        <section aria-labelledby="decided" className="flex flex-col gap-2">
          <h2 id="decided" className="text-xl font-semibold">Decided</h2>
          <ul className="flex flex-col gap-1 text-sm text-ink-soft">
            {decided.map((a) => (
              <li key={a.id}>
                <span className={a.status === "approved" ? "text-clear" : "text-blocked"}>{a.status === "approved" ? "Approved" : "Rejected"}</span>: {a.summary}
                {a.reason ? ` Note: ${a.reason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
