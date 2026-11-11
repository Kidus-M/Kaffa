import Link from "next/link";
import { Suspense } from "react";
import { PlotStrip } from "@/components/plot-strip";
import { RunChecks } from "@/components/run-checks";
import { STATUS_BG, needText, reasonText } from "@/components/status";
import { consoleContext } from "@/lib/console";
import { describeEvent } from "@/lib/describe-event";
import { DEADLINE, dayMonth, daysUntil, getAttention, getLedgerStatus, getRecentEvents, getShipments, type ShipmentView } from "@/lib/queries";

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-12">
      <Suspense fallback={<div className="h-28" />}>
        <Deadline />
      </Suspense>
      <Suspense fallback={<p className="text-ink-soft">Loading shipments…</p>}>
        <Shipments />
      </Suspense>
      <div className="grid gap-12 xl:grid-cols-[1.2fr_1fr]">
        <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
          <Attention />
        </Suspense>
        <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
          <Ledger />
        </Suspense>
      </div>
    </div>
  );
}

async function Deadline() {
  await consoleContext();
  const days = daysUntil(DEADLINE);
  return (
    <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.95] font-bold tracking-tight text-ink tabular-nums">
          {days} days
        </h1>
        <p className="mt-3 max-w-xl text-lg text-ink-soft">
          until EU buyers must prove every lot is deforestation-free, on 30 December 2026.
        </p>
      </div>
      <RunChecks />
    </header>
  );
}

function Legend() {
  const items = [
    ["clear", "Clear"],
    ["review", "Needs review"],
    ["blocked", "Blocked"],
    ["not_checked", "Not checked"],
  ] as const;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
      {items.map(([s, l]) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={`size-3 rounded-tile ${STATUS_BG[s]}`} aria-hidden />
          {l}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-tile bg-clear ring-2 ring-ink ring-offset-1" aria-hidden />
        Field request open
      </li>
    </ul>
  );
}

async function Shipments() {
  const { db, orgId } = await consoleContext();
  const shipments = await getShipments(db, orgId);
  return (
    <section aria-labelledby="shipments" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="shipments" className="text-xl font-semibold">Shipments</h2>
        <Legend />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
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
  const shipIn = daysUntil(s.shipDate);
  return (
    <article className="flex flex-col gap-5 rounded-lg border border-rule bg-sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">
            {s.ref} to {s.destinationPort}
          </h3>
          <p className="text-sm text-ink-soft">
            {s.buyerName}, ships {dayMonth(s.shipDate)}, in {shipIn} days
          </p>
        </div>
        <div className="text-right">
          {blocked ? (
            <>
              <p className={`text-3xl font-bold tabular-nums ${tone}`}>{blocked} blocked</p>
              <p className="text-sm text-ink-soft">{blocked === 1 ? "plot needs" : "plots need"} your decision</p>
            </>
          ) : (
            <>
              <p className={`text-3xl font-bold tabular-nums ${tone}`}>{pct}%</p>
              <p className="text-sm text-ink-soft">chance of shipping on time</p>
            </>
          )}
        </div>
      </div>
      <ul className="flex flex-col gap-4">
        {s.lots.map((l) => (
          <li key={l.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {l.ref} <span className="font-normal text-ink-soft">{l.grade}, {(l.quantityKg / 1000).toFixed(1)} t</span>
              </span>
              <span className={l.state === "ready" ? "font-medium text-clear" : "text-ink-soft"}>{l.state === "ready" ? "Ready" : "Held"}</span>
            </div>
            <PlotStrip plots={l.plots} animate />
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-soft">
        {blocked ? `Blocked plots hold their lots until they are removed or disproved. Field work alone could be done by ${dayMonth(s.forecast.p50)}. ` : null}
        {blocked ? null : <>Likely ready by {dayMonth(s.forecast.p50)}, and by {dayMonth(s.forecast.p90)} in nine runs out of ten, from {s.forecast.runs.toLocaleString()} simulations of each field agent&apos;s past response times.{" "}</>}
        <Link href={`/portal/${s.portalToken}`} className="text-canopy underline underline-offset-2">
          Open the buyer&apos;s view
        </Link>
      </p>
    </article>
  );
}

async function Attention() {
  const { db, orgId } = await consoleContext();
  const { pending, reviews, openRequests } = await getAttention(db, orgId);
  return (
    <section aria-labelledby="attention" className="flex flex-col gap-4">
      <h2 id="attention" className="text-xl font-semibold">Needs you</h2>
      {pending.length === 0 && reviews.length === 0 ? (
        <p className="text-ink-soft">Nothing is waiting for a decision.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-sheet">
          {reviews.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span>
                <Link href={`/plots/${r.ref}`} className="font-medium text-canopy underline-offset-2 hover:underline">{r.ref}</Link>{" "}
                <span className="text-ink-soft">{reasonText(r.reasons[0] ?? "review")}</span>
              </span>
              <Link href={`/plots/${r.ref}`} className="shrink-0 text-sm font-medium text-canopy">Review</Link>
            </li>
          ))}
          {pending.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-ink">{a.summary}</span>
              <Link href="/approvals" className="shrink-0 text-sm font-medium text-canopy">Decide</Link>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-4 font-semibold">Waiting on the field</h3>
      {openRequests.length === 0 ? (
        <p className="text-ink-soft">No open field requests.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {openRequests.slice(0, 8).map((g) => (
            <li key={g.id} className="flex flex-wrap justify-between gap-2">
              <span>
                <Link href={`/plots/${g.plotRef}`} className="font-medium text-canopy underline-offset-2 hover:underline">{g.plotRef}</Link>{" "}
                {needText(g.need)}
              </span>
              <span className="text-ink-soft">
                {g.agent.replace(" (synthetic)", "")}
                {g.reminders ? `, ${g.reminders} reminder${g.reminders > 1 ? "s" : ""}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Ledger() {
  const { db, orgId } = await consoleContext();
  const [status, events] = await Promise.all([getLedgerStatus(db, orgId), getRecentEvents(db, orgId)]);
  return (
    <section aria-labelledby="ledger" className="flex flex-col gap-4">
      <h2 id="ledger" className="text-xl font-semibold">What happened</h2>
      <p className="text-sm text-ink-soft">
        {status.verification.ok ? (
          <>
            All {status.count} ledger entries verified. Latest hash{" "}
            <span className="break-all text-ink">{status.verification.head.slice(0, 16)}</span>.
          </>
        ) : (
          <span className="text-blocked">The ledger chain is broken at entry {status.verification.brokenAt}.</span>
        )}
      </p>
      <ol className="flex flex-col gap-3 border-l-2 border-rule pl-4">
        {events.map((e) => (
          <li key={e.seq} className="text-sm">
            <p>{describeEvent(e.type, e.payload)}</p>
            <p className="text-xs text-ink-soft">
              {new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
