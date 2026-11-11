import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
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
    <div className="flex flex-col gap-6">
      <PageHeader title="Approvals" description="Agents ask before anything with legal or commercial weight. Every decision and its reason goes on the ledger." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
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
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        {pending.length === 0 ? (
          <EmptyState title="Nothing is waiting for you">Escalations and field photos appear here when an agent needs a decision.</EmptyState>
        ) : (
          pending.map((a) => (
            <Card as="article" key={a.id} className="flex flex-col gap-4 p-6">
              <div>
                <p className="text-[15px] font-medium">{KIND_TEXT[a.kind] ?? a.kind}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{a.summary}</p>
              </div>
              <form action={decideApproval} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input type="hidden" name="id" value={a.id} />
                <input
                  name="reason"
                  aria-label="Note for the ledger, optional"
                  placeholder="Note for the ledger (optional)"
                  className="h-10 flex-1 rounded-full bg-page px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] placeholder:text-ink-faint"
                />
                <div className="flex gap-2">
                  <button name="decision" value="approved" className={buttonClass("primary", "sm")}>
                    Approve
                  </button>
                  <button name="decision" value="rejected" className={buttonClass("secondary", "sm")}>
                    Reject
                  </button>
                </div>
              </form>
            </Card>
          ))
        )}
      </div>
      <Card aria-labelledby="decided" className="xl:sticky xl:top-12">
        <CardHeader id="decided" title="Decided" />
        {decided.length === 0 ? (
          <p className="px-6 pt-3 pb-6 text-sm text-ink-soft">No decisions yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 px-6 pt-3 pb-6 text-sm">
            {decided.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5">
                <span className={`text-[13px] font-medium ${a.status === "approved" ? "text-clear" : "text-blocked"}`}>{a.status === "approved" ? "Approved" : "Rejected"}</span>
                <span className="text-ink-soft">{a.summary}</span>
                {a.reason ? <span className="text-[13px] text-ink-faint">Note: {a.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
