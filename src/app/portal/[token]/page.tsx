import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { PlotStrip } from "@/components/plot-strip";
import { STATUS_BG, StatusBadge } from "@/components/status";
import { getDb } from "@/db/client";
import { getLedgerStatus, getShipmentByToken, getShipments, dayMonth } from "@/lib/queries";

export const metadata = { title: "Buyer portal", robots: { index: false } };

export default function PortalPage({ params }: PageProps<"/portal/[token]">) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10 sm:px-8">
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Portal params={params} />
      </Suspense>
    </div>
  );
}

async function Portal({ params }: { params: PageProps<"/portal/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  const shipment = await getShipmentByToken(db, token);
  if (!shipment) notFound();
  const view = (await getShipments(db, shipment.orgId)).find((s) => s.id === shipment.id)!;
  const ledger = await getLedgerStatus(db, shipment.orgId);
  const plotsAll = view.lots.flatMap((l) => l.plots);

  return (
    <>
      <header className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">Shared with {shipment.buyerName} by Sidama Highland Exporters (synthetic)</p>
        <h1 className="text-4xl font-bold tracking-tight">
          {shipment.ref} to {shipment.destinationPort}
        </h1>
        <p className="max-w-2xl text-lg text-ink-soft">
          Deforestation evidence for every plot behind this shipment, ships {dayMonth(shipment.shipDate)}.{" "}
          {view.lots.every((l) => l.state === "ready")
            ? "All lots are ready."
            : `${view.lots.filter((l) => l.state === "ready").length} of ${view.lots.length} lots are ready; the exporter is resolving the rest.`}
        </p>
      </header>

      <section aria-labelledby="lots" className="flex flex-col gap-5">
        <h2 id="lots" className="text-xl font-semibold">Lots</h2>
        {view.lots.map((l) => (
          <article key={l.id} className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                {l.ref} <span className="font-normal text-ink-soft">{l.grade}, {(l.quantityKg / 1000).toFixed(1)} t</span>
              </h3>
              <span className={l.state === "ready" ? "font-medium text-clear" : "text-ink-soft"}>{l.state === "ready" ? "Ready" : "Being resolved"}</span>
            </div>
            <PlotStrip plots={l.plots} link={false} />
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a className="text-canopy underline underline-offset-2" href={`/api/export/${l.ref}?token=${token}`}>
                Download plots for the EU information system (GeoJSON)
              </a>
              <a className="text-canopy underline underline-offset-2" href={`/api/export/${l.ref}?token=${token}&file=sheet`}>
                Download the due diligence data sheet
              </a>
            </p>
          </article>
        ))}
      </section>

      <section aria-labelledby="plots" className="flex flex-col gap-3">
        <h2 id="plots" className="text-xl font-semibold">Plot status</h2>
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {plotsAll.map((p) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className={`size-2.5 rounded-tile ${STATUS_BG[p.status]}`} aria-hidden />
                {p.ref}
              </span>
              <StatusBadge status={p.status} accepted={p.reviewAccepted} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="trust" className="flex flex-col gap-2 text-sm text-ink-soft">
        <h2 id="trust" className="text-xl font-semibold text-ink">How to trust this</h2>
        <p>
          Every check, field reply and decision is written to a hash-chained ledger. Editing any past entry breaks the chain.{" "}
          {ledger.verification.ok
            ? `The chain verifies now: ${ledger.count} entries, latest hash ${ledger.verification.head.slice(0, 16)}. The same hash is printed on each data sheet.`
            : "The chain does not verify; contact the exporter."}
        </p>
        <p>
          Statuses come from fixed rules over satellite data, never from an AI model. This evidence supports your due diligence; it is not a legal determination of compliance. All farms in this demo are synthetic.
        </p>
      </section>
    </>
  );
}
