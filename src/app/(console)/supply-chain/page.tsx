import Link from "next/link";
import { Suspense } from "react";
import { ScanSearch } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { CustodyGraph } from "@/components/custody-graph";
import { ReasonForm } from "@/components/reason-form";
import { Card, CardHeader, Fact, PageHeader } from "@/components/ui";
import { plausibleKg } from "@/domain/custody";
import { consoleContext } from "@/lib/console";
import { getCustody, getLotVolumes, type FlagView } from "@/services/custody";
import { auditAction, clearFlagAction } from "../actions";

export const metadata = { title: "Supply chain" };

export default function SupplyChainPage({ searchParams }: PageProps<"/supply-chain">) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Supply chain"
        description="Where every kilogram came from. The auditor compares each delivery with what its farm can plausibly grow, area times regional yield, and holds any lot that may contain coffee from unmapped farms."
        actions={<ActionButton action={auditAction} label="Run the auditor" pendingLabel="Checking" align="end" icon={<ScanSearch className="size-4" />} />}
      />
      <Suspense fallback={<div className="h-[32rem] animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/supply-chain">["searchParams"] }) {
  const { db, orgId } = await consoleContext();
  const lots = await getLotVolumes(db, orgId);
  const params = await searchParams;
  const selected = (typeof params.lot === "string" && lots.find((l) => l.ref === params.lot)?.ref) || lots.find((l) => l.openFlags)?.ref || lots[0]?.ref;
  const custody = selected ? await getCustody(db, orgId, selected) : null;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="overflow-hidden xl:sticky xl:top-12">
        <nav aria-label="Lots">
          <ul className="divide-y divide-hairline">
            {lots.map((l) => {
              const active = l.ref === selected;
              return (
                <li key={l.ref}>
                  <Link
                    href={`/supply-chain?lot=${l.ref}`}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between gap-3 px-5 py-3.5 transition-colors ${active ? "bg-leaf-wash" : "hover:bg-page"}`}
                  >
                    <span className="min-w-0">
                      <span className={`block text-sm font-medium ${active ? "text-leaf-ink" : ""}`}>{l.ref}</span>
                      <span className="block truncate text-[12px] text-ink-faint">
                        {l.suppliers} suppliers · {(l.deliveredKg / 1000).toFixed(1)} t
                      </span>
                    </span>
                    {l.openFlags ? (
                      <span className="shrink-0 rounded-full bg-blocked-wash px-2 py-0.5 text-[12px] font-medium text-blocked">
                        {l.openFlags} flag{l.openFlags > 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[12px] text-clear">Adds up</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </Card>

      {custody ? (
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-6 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[19px] font-medium tracking-[-0.01em]">
                {custody.lot.ref} <span className="font-normal text-ink-soft">{custody.lot.grade}</span>
              </h2>
              <span className={`text-sm font-medium ${custody.lot.state === "ready" ? "text-clear" : "text-review"}`}>{custody.lot.state === "ready" ? "Ready" : "Held"}</span>
            </div>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label="Delivered">{(custody.deliveredKg / 1000).toFixed(2)} t</Fact>
              <Fact label="Lot weight">{(custody.lot.quantityKg / 1000).toFixed(2)} t</Fact>
              <Fact label="Suppliers">{custody.suppliers}</Fact>
              <Fact label="Shipment">{custody.shipment?.ref ?? "Not allocated"}</Fact>
            </dl>
            <CustodyGraph nodes={custody.graph.nodes} edges={custody.graph.edges} />
          </Card>

          <Card aria-labelledby="flags">
            <CardHeader id="flags" title="Auditor's flags" meta={`${custody.flags.filter((f) => f.status === "open").length} open`} />
            {custody.flags.length ? (
              <ul className="flex flex-col divide-y divide-hairline px-6 pt-2 pb-2">
                {custody.flags.map((f) => (
                  <li key={f.id} className="flex flex-col gap-3 py-5">
                    <FlagText flag={f} />
                    {f.status === "open" ? (
                      <ReasonForm
                        plotRef={f.id}
                        field="flagId"
                        action={clearFlagAction}
                        title="Clear this flag"
                        help="Only clear it with evidence: a second plot being mapped, a corrected delivery record, or a site visit. The reason goes on the ledger."
                        placeholder="For example: the farmer also farms a mapped plot under his wife's name; deliveries are plausible together."
                        submit="Clear flag"
                        pendingLabel="Clearing"
                      />
                    ) : (
                      <p className="text-[13px] text-ink-faint">Cleared: {f.reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-6 pt-2 pb-6 text-sm text-ink-soft">Every delivery into this lot is within what its farms can grow, and every supplier has a mapped plot.</p>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function FlagText({ flag }: { flag: FlagView }) {
  const d = flag.detail;
  const open = flag.status === "open";
  return (
    <div className="flex flex-col gap-1">
      <p className={`text-[15px] font-medium ${open ? "text-blocked" : "text-ink-soft"}`}>
        {d.kind === "unmapped_supplier"
          ? `${flag.subject} has no mapped plot`
          : d.kind === "volume_farmer"
            ? `${flag.subject} delivered more than their farm can grow`
            : "The lot holds more coffee than its farms can grow"}
      </p>
      <p className="text-sm leading-relaxed text-ink-soft">
        {d.kind === "unmapped_supplier"
          ? `${d.deliveredKg.toLocaleString()} kg came from a supplier with no plot on record. The EUDR needs the geolocation of every plot behind a lot (Article 9), so this coffee cannot be traced.`
          : `${d.deliveredKg.toLocaleString()} kg delivered from ${d.areaHa} ha${d.kind === "volume_farmer" ? ` (${d.plotRefs.join(", ")})` : ""}. At most ${d.plausibleKg.toLocaleString()} kg is plausible: ${d.areaHa} ha at 0.9 t/ha with 50% headroom (${plausibleKg(1).toLocaleString()} kg per hectare).`}
      </p>
    </div>
  );
}
