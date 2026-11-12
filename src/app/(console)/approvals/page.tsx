import { Suspense } from "react";
import { desc, eq, inArray } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import { ApprovalForm } from "@/components/approval-form";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { approvals, questions, shipments } from "@/db/schema";
import { consoleContext } from "@/lib/console";
import { dayMonth } from "@/lib/queries";

export const metadata = { title: "Approvals" };

const KIND: Record<string, { title: string; agent: string }> = {
  escalation: { title: "A field agent has not replied", agent: "Field liaison" },
  review_photo: { title: "A field photo arrived for a review plot", agent: "Field liaison" },
  merge_farmers: { title: "Is this the same farmer?", agent: "Intake" },
  change_allocation: { title: "Change the container plan", agent: "Shipment planner" },
  create_shipment: { title: "New contract from a buyer email", agent: "Intake" },
  send_reply: { title: "Send this reply to a buyer", agent: "Buyer liaison" },
  buyer_answer: { title: "Publish this answer on the buyer portal", agent: "Buyer liaison" },
  buyer_question: { title: "A buyer asked something no source answers", agent: "Buyer liaison" },
  send_day_plan: { title: "Send a field agent's day plan", agent: "Field planner" },
};

export default function ApprovalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Approvals" description="Agents ask before anything with legal or commercial weight. Approving runs the action; every decision and its note go on the ledger." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <ApprovalList />
      </Suspense>
    </div>
  );
}

type Row = typeof approvals.$inferSelect;

async function ApprovalList() {
  const { db, orgId } = await consoleContext();
  const rows = await db.select().from(approvals).where(eq(approvals.orgId, orgId)).orderBy(desc(approvals.createdAt)).limit(60);
  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");
  const questionIds = pending.map((r) => (r.payload as { questionId?: string } | null)?.questionId).filter((x): x is string => Boolean(x));
  const qs = questionIds.length ? await db.select().from(questions).where(inArray(questions.id, questionIds)) : [];
  const ships = await db.select({ id: shipments.id, ref: shipments.ref }).from(shipments).where(eq(shipments.orgId, orgId));
  const shipRef = (id: string | null) => ships.find((s) => s.id === id)?.ref ?? "spare";

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        {pending.length === 0 ? (
          <EmptyState title="Nothing is waiting for you">Merges, plan changes, contracts, buyer replies and escalations appear here when an agent needs a decision.</EmptyState>
        ) : (
          pending.map((a) => (
            <Card as="article" key={a.id} className="flex flex-col gap-4 p-6">
              <div className="flex flex-col gap-1">
                <p className="text-[12px] font-medium tracking-wide text-ink-faint uppercase">{KIND[a.kind]?.agent ?? "Agent"}</p>
                <h2 className="text-[16px] font-medium">{KIND[a.kind]?.title ?? a.kind}</h2>
              </div>
              <Detail row={a} question={qs.find((q) => q.id === (a.payload as { questionId?: string } | null)?.questionId)} shipRef={shipRef} />
              <ApprovalForm
                id={a.id}
                noteRequired={a.kind === "buyer_question"}
                noteLabel={a.kind === "buyer_question" ? "Your answer to the buyer; it is published as written" : undefined}
              />
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
                <span className={`text-[13px] font-medium ${a.status === "approved" ? "text-clear" : "text-blocked"}`}>
                  {a.status === "approved" ? "Approved" : "Rejected"}: {KIND[a.kind]?.title.toLowerCase() ?? a.kind}
                </span>
                <span className="line-clamp-2 text-ink-soft">{a.summary}</span>
                {a.reason ? <span className="text-[13px] text-ink-faint">Note: {a.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Detail({ row, question, shipRef }: { row: Row; question?: typeof questions.$inferSelect; shipRef: (id: string | null) => string }) {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  switch (row.kind) {
    case "merge_farmers": {
      const m = p as { keepLabel: string; mergeLabel: string; score: number; reasons: string[] };
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-[15px]">
            <span className="rounded-full bg-page px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--color-hairline)]">{m.mergeLabel}</span>
            <ArrowRight className="size-4 text-ink-faint" />
            <span className="rounded-full bg-leaf-wash px-3 py-1.5 text-leaf-ink">{m.keepLabel}</span>
            <span className="text-sm text-ink-soft">match {Math.round(m.score * 100)}%</span>
          </div>
          <ul className="flex flex-col gap-1 text-sm text-ink-soft">
            {m.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
          <p className="text-[13px] text-ink-faint">Approving moves the plots and deliveries to one record and keeps both spellings as aliases.</p>
        </div>
      );
    }
    case "change_allocation": {
      const c = p as { changes: { lotRef: string; from: string | null; to: string | null }[]; before: Record<string, number>; after: Record<string, number> };
      return (
        <div className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1.5">
            {c.changes.map((x) => (
              <li key={x.lotRef} className="flex items-center gap-2">
                <span className="font-medium">{x.lotRef}</span>
                <span className="text-ink-soft">{shipRef(x.from)}</span>
                <ArrowRight className="size-3.5 text-ink-faint" />
                <span className="text-ink-soft">{shipRef(x.to)}</span>
              </li>
            ))}
          </ul>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {Object.keys(c.after).map((id) => (
              <div key={id}>
                <dt className="text-[13px] text-ink-faint">{shipRef(id)} on time</dt>
                <dd className="tabular-nums">
                  {Math.round((c.before[id] ?? 0) * 100)}% <span className="text-ink-faint">to</span> <span className="font-medium text-clear">{Math.round(c.after[id] * 100)}%</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    }
    case "create_shipment": {
      const s = p as { ref: string | null; buyerName: string; volumeKg: number | null; grade: string | null; destinationPort: string | null; shipDate: string | null; mode: string };
      return (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {[
            ["Contract", s.ref ?? "Not stated"],
            ["Buyer", s.buyerName],
            ["Volume", s.volumeKg ? `${(s.volumeKg / 1000).toFixed(1)} t` : "Not stated"],
            ["Grade", s.grade ?? "Not stated"],
            ["Port", s.destinationPort ?? "Not stated"],
            ["Ship by", s.shipDate ? dayMonth(s.shipDate) : "Not stated"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[13px] text-ink-faint">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <p className="col-span-full text-[13px] text-ink-faint">Read by {s.mode === "gemini" ? "Gemini" : "rules, without AI"}. Approving creates the shipment and re-runs the container planner.</p>
        </dl>
      );
    }
    case "send_reply":
    case "buyer_answer":
    case "buyer_question":
      return question ? (
        <div className="flex flex-col gap-3 text-sm">
          <blockquote className="border-l-2 border-hairline-strong pl-3 text-ink-soft">
            {question.asker}: &ldquo;{question.question}&rdquo;
          </blockquote>
          {question.answer ? (
            <div className="rounded-[var(--radius-control)] bg-page p-4 leading-relaxed">
              <p>{question.answer}</p>
              <p className="mt-2 text-[13px] text-ink-faint">Sources: {question.citations.map((c) => c.label).join("; ")}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">{row.summary}</p>
      );
    case "send_day_plan":
      return <pre className="rounded-[var(--radius-control)] bg-page p-4 font-sans text-sm whitespace-pre-line">{String(p.text)}</pre>;
    default:
      return <p className="text-sm leading-relaxed text-ink-soft">{row.summary}</p>;
  }
}
