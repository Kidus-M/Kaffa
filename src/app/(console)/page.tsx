import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight } from "lucide-react";
import { PlotStrip } from "@/components/plot-strip";
import { RunChecks } from "@/components/run-checks";
import { STATUS_BG, needText, reasonText } from "@/components/status";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import type { PlotStatus } from "@/domain/types";
import { consoleContext } from "@/lib/console";
import { describeEvent } from "@/lib/describe-event";
import {
  DEADLINE,
  dayMonth,
  daysUntil,
  getAttention,
  getLedgerStatus,
  getPlotCounts,
  getRecentEvents,
  getShipments,
  type ShipmentView,
} from "@/lib/queries";

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Overview"
        description="Every EU-bound lot, the evidence behind it, and what still stands between it and the ship date."
        actions={<RunChecks />}
      />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <Headline />
      </Suspense>
      <Suspense fallback={<div className="h-80 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <Shipments />
      </Suspense>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
          <Attention />
        </Suspense>
        <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
          <Ledger />
        </Suspense>
      </div>
    </div>
  );
}

const SEGMENTS: { key: PlotStatus; label: string; href: string }[] = [
  { key: "clear", label: "Clear", href: "/plots?status=clear" },
  { key: "review", label: "Needs review", href: "/plots?status=review" },
  { key: "blocked", label: "Blocked", href: "/plots?status=blocked" },
  { key: "not_checked", label: "Not checked", href: "/plots?status=not_checked" },
];

/** The one answer the page must give in five seconds: how many lots can ship. */
async function Headline() {
  const { db, orgId } = await consoleContext();
  const [shipments, counts, attention] = await Promise.all([getShipments(db, orgId), getPlotCounts(db, orgId), getAttention(db, orgId)]);
  const lots = shipments.flatMap((s) => s.lots);
  const ready = lots.filter((l) => l.state === "ready").length;
  const days = daysUntil(DEADLINE);
  const next = shipments[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card className="flex flex-col gap-6 p-6 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-ink-soft">Lots ready to ship</p>
            <p className="mt-1 text-[clamp(2.6rem,6vw,3.8rem)] leading-none font-light tracking-[-0.04em] tabular-nums">
              {ready}
              <span className="text-ink-faint"> of {lots.length}</span>
            </p>
          </div>
          <p className="max-w-64 text-sm text-ink-soft">A lot ships when every plot is clear or accepted, and no field request is open.</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={SEGMENTS.map((s) => `${counts[s.key]} ${s.label.toLowerCase()}`).join(", ")}>
            {SEGMENTS.map((s) => (
              <span key={s.key} className={STATUS_BG[s.key]} style={{ width: `${(counts[s.key] / Math.max(1, counts.total)) * 100}%` }} />
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SEGMENTS.map((s) => (
              <li key={s.key}>
                <Link href={s.href} className="group flex flex-col gap-0.5 rounded-[var(--radius-control)] px-3 py-2.5 transition-colors hover:bg-sunken">
                  <span className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                    <span className={`size-2 rounded-full ${STATUS_BG[s.key]}`} aria-hidden />
                    {s.label}
                  </span>
                  <span className="text-2xl font-light tracking-[-0.02em] tabular-nums">{counts[s.key]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card className="flex flex-col justify-between gap-6 p-6 sm:p-7">
        <div>
          <p className="text-sm text-ink-soft">Until the EUDR applies</p>
          <p className="mt-1 text-[clamp(2.6rem,6vw,3.8rem)] leading-none font-light tracking-[-0.04em] tabular-nums">
            {days}
            <span className="text-ink-faint"> days</span>
          </p>
          <p className="mt-2 text-sm text-ink-soft">30 December 2026, for large and medium EU buyers.</p>
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t border-hairline pt-5">
          <div>
            <dt className="text-[13px] text-ink-faint">Next ship date</dt>
            <dd className="text-[15px]">{next ? `${dayMonth(next.shipDate)}, ${next.ref}` : "None"}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-faint">Field requests open</dt>
            <dd className="text-[15px] tabular-nums">{attention.openRequests.length}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

async function Shipments() {
  const { db, orgId } = await consoleContext();
  const shipments = await getShipments(db, orgId);
  return (
    <section aria-labelledby="shipments" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="shipments" className="text-[19px] font-medium tracking-[-0.015em]">Shipments</h2>
        <p className="text-[13px] text-ink-soft">Each tile is one farm plot. A ring means a field request is still open.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {shipments.map((s) => (
          <ShipmentCard key={s.id} s={s} />
        ))}
      </div>
    </section>
  );
}

function ShipmentCard({ s }: { s: ShipmentView }) {
  const pct = Math.round(s.forecast.pOnTime * 100);
  const blocked = s.lots.flatMap((l) => l.plots).filter((p) => p.status === "blocked").length;
  const tone = blocked ? "text-blocked" : pct >= 80 ? "text-clear" : pct >= 50 ? "text-review" : "text-blocked";
  return (
    <Card as="article" className="flex flex-col">
      <div className="flex items-start justify-between gap-4 p-6 pb-5">
        <div className="min-w-0">
          <h3 className="text-[17px] font-medium tracking-[-0.01em]">
            {s.ref} to {s.destinationPort}
          </h3>
          <p className="mt-0.5 text-sm text-ink-soft">
            {s.buyerName}, ships {dayMonth(s.shipDate)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-[28px] leading-none font-light tracking-[-0.03em] tabular-nums ${tone}`}>{blocked ? blocked : `${pct}%`}</p>
          <p className="mt-1 text-[13px] text-ink-soft">{blocked ? (blocked === 1 ? "plot blocked" : "plots blocked") : "on-time chance"}</p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-hairline border-t border-hairline">
        {s.lots.map((l) => (
          <li key={l.id} className="flex flex-col gap-3 px-6 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{l.ref}</span> <span className="text-ink-soft">{l.grade}, {(l.quantityKg / 1000).toFixed(1)} t</span>
              </span>
              <span className={`text-[13px] font-medium ${l.state === "ready" ? "text-clear" : "text-ink-faint"}`}>{l.state === "ready" ? "Ready" : "Held"}</span>
            </div>
            <PlotStrip plots={l.plots} animate />
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-6 py-4 text-[13px] text-ink-soft">
        <span>
          {blocked
            ? "Blocked plots hold their lots until removed or disproved."
            : `Likely ready ${dayMonth(s.forecast.p50)}, at worst ${dayMonth(s.forecast.p90)}.`}
        </span>
        <Link href={`/portal/${s.portalToken}`} className="inline-flex items-center gap-1 font-medium text-ink hover:text-leaf">
          Buyer&apos;s view <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </Card>
  );
}

async function Attention() {
  const { db, orgId } = await consoleContext();
  const { pending, reviews, openRequests } = await getAttention(db, orgId);
  const decisions = reviews.length + pending.length;
  return (
    <Card aria-labelledby="attention" className="flex flex-col">
      <CardHeader id="attention" title="Needs you" meta={decisions ? `${decisions} decisions` : undefined} />
      <div className="flex flex-col gap-1 p-3 sm:p-4">
        {decisions === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-soft">Nothing is waiting for a decision.</p>
        ) : (
          <ul className="flex flex-col">
            {reviews.map((r) => (
              <li key={r.id}>
                <Link href={`/plots/${r.ref}`} className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] px-3 py-2.5 transition-colors hover:bg-sunken">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{r.ref}</span> <span className="text-ink-soft">{reasonText(r.reasons[0] ?? "review")}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-review-wash px-2.5 py-0.5 text-[12px] font-medium text-review">Review</span>
                </Link>
              </li>
            ))}
            {pending.map((a) => (
              <li key={a.id}>
                <Link href="/approvals" className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] px-3 py-2.5 transition-colors hover:bg-sunken">
                  <span className="min-w-0 text-sm text-ink">{a.summary}</span>
                  <span className="shrink-0 rounded-full bg-sunken px-2.5 py-0.5 text-[12px] font-medium text-ink-soft">Decide</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-3 px-3 text-[13px] font-medium text-ink-faint">Waiting on the field</h3>
        {openRequests.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-soft">No open field requests.</p>
        ) : (
          <ul className="flex flex-col">
            {openRequests.slice(0, 7).map((g) => (
              <li key={g.id}>
                <Link href={`/plots/${g.plotRef}`} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors hover:bg-sunken">
                  <span className="min-w-0">
                    <span className="font-medium">{g.plotRef}</span> <span className="text-ink-soft">{needText(g.need)}</span>
                  </span>
                  <span className="shrink-0 text-[13px] text-ink-faint">
                    {g.agent.replace(" (synthetic)", "").split(" ")[0]}
                    {g.reminders ? `, ${g.reminders} reminder${g.reminders > 1 ? "s" : ""}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

async function Ledger() {
  const { db, orgId } = await consoleContext();
  const [status, events] = await Promise.all([getLedgerStatus(db, orgId), getRecentEvents(db, orgId, 9)]);
  return (
    <Card aria-labelledby="ledger" className="flex flex-col">
      <CardHeader
        id="ledger"
        title="What happened"
        meta={
          status.verification.ok ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-clear" aria-hidden />
              Ledger verified, {status.count} entries
            </span>
          ) : (
            <span className="text-blocked">Ledger broken at entry {status.verification.brokenAt}</span>
          )
        }
      />
      {events.length === 0 ? (
        <div className="p-6">
          <EmptyState title="No activity yet">Run today&apos;s checks to start.</EmptyState>
        </div>
      ) : (
        <ol className="flex flex-col gap-0 px-6 pt-4 pb-6">
          {events.map((e, i) => (
            <li key={e.seq} className="relative flex gap-4 pb-4 last:pb-0">
              <span className="relative flex w-2 justify-center" aria-hidden>
                <span className="mt-1.5 size-2 rounded-full bg-hairline-strong" />
                {i < events.length - 1 ? <span className="absolute top-4 bottom-[-4px] w-px bg-hairline" /> : null}
              </span>
              <span className="min-w-0 text-sm">
                <span className="text-ink">{describeEvent(e.type, e.payload)}</span>
                <span className="block text-[12px] text-ink-faint">
                  {new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
