import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { Download, ShieldCheck } from "lucide-react";
import { PlotStrip } from "@/components/plot-strip";
import { StatusBadge } from "@/components/status";
import { Card, CardHeader, buttonClass } from "@/components/ui";
import { getDb } from "@/db/client";
import { dayMonth, getLedgerStatus, getShipmentByToken, getShipments } from "@/lib/queries";

export const metadata = { title: "Buyer portal", robots: { index: false } };

export default function PortalPage({ params }: PageProps<"/portal/[token]">) {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8 px-4 py-10 sm:px-8 sm:py-14">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
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
  const plots = view.lots.flatMap((l) => l.plots);
  const ready = view.lots.filter((l) => l.state === "ready").length;

  return (
    <>
      <header className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">Shared with {shipment.buyerName} by Sidama Highland Exporters (synthetic)</p>
        <h1 className="text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-light tracking-[-0.03em]">
          {shipment.ref} to {shipment.destinationPort}
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          Deforestation evidence for every plot behind this shipment, which ships {dayMonth(shipment.shipDate)}. {ready} of {view.lots.length} lots are ready
          {ready < view.lots.length ? "; the exporter is resolving the rest." : "."}
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {view.lots.map((l) => (
          <Card as="article" key={l.id} className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-medium tracking-[-0.01em]">
                {l.ref} <span className="font-normal text-ink-soft">{l.grade}, {(l.quantityKg / 1000).toFixed(1)} t</span>
              </h2>
              <span className={`text-[13px] font-medium ${l.state === "ready" ? "text-clear" : "text-ink-faint"}`}>{l.state === "ready" ? "Ready" : "Being resolved"}</span>
            </div>
            <PlotStrip plots={l.plots} link={false} />
            {l.state === "ready" ? (
              <div className="flex flex-wrap gap-2">
                <a className={buttonClass("primary", "sm")} href={`/api/export/${l.ref}?token=${token}`}>
                  <Download className="size-3.5" /> Plots for the EU information system
                </a>
                <a className={buttonClass("secondary", "sm")} href={`/api/export/${l.ref}?token=${token}&file=sheet`}>
                  <Download className="size-3.5" /> Due diligence data sheet
                </a>
              </div>
            ) : (
              <p className="text-[13px] text-ink-soft">Downloads open when every plot in this lot is resolved.</p>
            )}
          </Card>
        ))}
      </div>

      <Card aria-labelledby="plots">
        <CardHeader id="plots" title="Plot status" meta={`${plots.length} plots`} />
        <ul className="grid gap-x-8 gap-y-2 px-6 pt-4 pb-6 text-sm sm:grid-cols-2">
          {plots.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3">
              <span className="font-medium">{p.ref}</span>
              <StatusBadge status={p.status} accepted={p.reviewAccepted} />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex gap-4 p-6">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-leaf" strokeWidth={1.75} />
        <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink-soft">
          <h2 className="text-[15px] font-medium text-ink">How to trust this</h2>
          <p>
            Every check, field reply and decision is written to a hash-chained ledger, so editing any past entry breaks the chain.{" "}
            {ledger.verification.ok
              ? `It verifies now: ${ledger.count} entries, latest hash ${ledger.verification.head.slice(0, 16)}, the same hash printed on each data sheet.`
              : "It does not verify; contact the exporter."}
          </p>
          <p>Statuses come from fixed rules over satellite data, never from an AI model. This evidence supports your due diligence; it is not a legal determination. All farms in this demo are synthetic.</p>
        </div>
      </Card>
    </>
  );
}
