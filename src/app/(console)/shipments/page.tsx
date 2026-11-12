import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Boxes } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { qualifies } from "@/domain/planner";
import { consoleContext } from "@/lib/console";
import { dayMonth, daysUntil, getShipments } from "@/lib/queries";
import { getQuestions } from "@/services/copilot";
import { getPlan } from "@/services/planner";
import { proposePlanAction } from "../actions";

export const metadata = { title: "Shipments" };

export default function ShipmentsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Shipments"
        description="Each contract, the lots in its containers, and the chance it ships on time. The planner re-solves the allocation whenever a lot is held, and proposes the smallest change that keeps every shipment whole."
        actions={<ActionButton action={proposePlanAction} label="Re-plan containers" pendingLabel="Solving" variant="primary" align="end" icon={<Boxes className="size-4" />} />}
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <Plan />
      </Suspense>
    </div>
  );
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const tone = (p: number) => (p >= 0.8 ? "text-clear" : p >= 0.4 ? "text-review" : "text-blocked");

async function Plan() {
  const { db, orgId } = await consoleContext();
  const [view, ships, questions] = await Promise.all([getPlan(db, orgId), getShipments(db, orgId), getQuestions(db, orgId)]);
  const { plan, before, lots, shipments } = view;
  const changed = plan.changes.length > 0;
  const spare = lots.filter((l) => !l.currentShipmentId);
  const refOf = (id: string | null) => shipments.find((s) => s.id === id)?.ref ?? "spare";

  return (
    <div className="flex flex-col gap-6">
      {changed ? (
        <Card className="flex flex-col gap-4 border-l-4 border-leaf p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-medium">The planner found a better allocation</h2>
            <span className="text-sm text-ink-soft">{plan.explored.toLocaleString()} allocations checked, exact</span>
          </div>
          <ul className="flex flex-col gap-2 text-[15px]">
            {plan.changes.map((c) => (
              <li key={c.lotId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.lotRef}</span>
                <span className="text-ink-soft">{refOf(c.from)}</span>
                <ArrowRight className="size-4 text-ink-faint" />
                <span className="text-ink-soft">{refOf(c.to)}</span>
                <span className="text-[13px] text-ink-faint">{lots.find((l) => l.id === c.lotId)?.why}</span>
              </li>
            ))}
          </ul>
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            {shipments.map((s) => (
              <div key={s.id}>
                <dt className="text-[13px] text-ink-faint">{s.ref} on time</dt>
                <dd className="text-[15px] tabular-nums">
                  {pct(before[s.id])} <span className="text-ink-faint">to</span> <span className={`font-medium ${tone(plan.pOnTime[s.id])}`}>{pct(plan.pOnTime[s.id])}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[13px] text-ink-soft">
            Changing an allocation asks first, unless you made it automatic in <Link href="/settings" className="underline underline-offset-2">Settings</Link>. Use “Re-plan containers” to send this to Approvals.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {shipments.map((s) => {
          const ship = ships.find((x) => x.id === s.id);
          const mine = lots.filter((l) => l.currentShipmentId === s.id);
          const kg = mine.reduce((t, l) => t + l.kg, 0);
          return (
            <Card as="article" key={s.id} className="flex flex-col gap-5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[19px] font-medium tracking-[-0.01em]">
                    {s.ref} <span className="font-normal text-ink-soft">to {ship?.destinationPort}</span>
                  </h2>
                  <p className="text-sm text-ink-soft">
                    {ship?.buyerName} · ships {dayMonth(s.shipDate)} ({daysUntil(s.shipDate)} days) · {s.gradeRequired} or better
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-3xl font-light tabular-nums ${tone(before[s.id])}`}>{pct(before[s.id])}</p>
                  <p className="text-[12px] text-ink-faint">chance on time now</p>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[13px] text-ink-soft">
                  <span>Containers filled</span>
                  <span className="tabular-nums">
                    {(kg / 1000).toFixed(1)} of {(s.volumeKg / 1000).toFixed(1)} t
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-leaf" style={{ width: `${Math.min(100, (kg / s.volumeKg) * 100)}%` }} />
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-ink-faint">
                    <th className="pb-2 font-normal">Lot</th>
                    <th className="pb-2 font-normal">Status</th>
                    <th className="pb-2 text-right font-normal">Ready by ship date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {mine.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5">
                        <Link href={`/supply-chain?lot=${l.ref}`} className="font-medium hover:underline">
                          {l.ref}
                        </Link>
                        <span className="block text-[12px] text-ink-faint">{l.grade}</span>
                      </td>
                      <td className="py-2.5 text-ink-soft">{l.why}</td>
                      <td className={`py-2.5 text-right tabular-nums ${tone(l.pReady[s.id])}`}>{pct(l.pReady[s.id])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ship ? (
                <Link href={`/portal/${ship.portalToken}`} className="w-fit text-sm text-ink-soft underline underline-offset-2 hover:text-ink">
                  Open the buyer portal
                </Link>
              ) : null}
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card aria-labelledby="spare">
          <CardHeader id="spare" title="Spare lots" meta={`${spare.length} not in a contract`} />
          {spare.length ? (
            <ul className="flex flex-col divide-y divide-hairline px-6 pt-2 pb-4 text-sm">
              {spare.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="font-medium">{l.ref}</span> <span className="text-ink-soft">{l.grade}</span>
                    <span className="block text-[12px] text-ink-faint">
                      {l.why}. Fits {shipments.filter((s) => qualifies(l, s)).map((s) => s.ref).join(", ") || "no open contract"}.
                    </span>
                  </span>
                  <span className="text-ink-soft tabular-nums">{(l.kg / 1000).toFixed(1)} t</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-6 pt-2 pb-6 text-sm text-ink-soft">Every lot is in a contract.</p>
          )}
        </Card>
        <Card aria-labelledby="questions">
          <CardHeader id="questions" title="Buyer questions" meta={`${questions.filter((q) => q.channel !== "console").length} asked`} />
          {questions.filter((q) => q.channel !== "console").length ? (
            <ul className="flex flex-col divide-y divide-hairline px-6 pt-2 pb-4 text-sm">
              {questions
                .filter((q) => q.channel !== "console")
                .reverse()
                .slice(0, 8)
                .map((q) => (
                  <li key={q.id} className="flex flex-col gap-1 py-3">
                    <span className="text-ink-soft">
                      {q.asker} by {q.channel}:{" "}
                      <span className={q.status === "answered" ? "text-clear" : q.status === "drafted" ? "text-review" : "text-blocked"}>
                        {q.status === "answered" ? "answered" : q.status === "drafted" ? "draft waiting for approval" : "needs you"}
                      </span>
                    </span>
                    <span>&ldquo;{q.question}&rdquo;</span>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="p-6 pt-3">
              <EmptyState title="No questions yet">Buyers ask from their portal, or by email once the inbox is read on the Intake page.</EmptyState>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
