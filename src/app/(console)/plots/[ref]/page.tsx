import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PlotMap } from "@/components/plot-map";
import { ReasonForm } from "@/components/reason-form";
import { StatusBadge, needText, reasonText } from "@/components/status";
import { Card, CardHeader, Fact, PageHeader } from "@/components/ui";
import { blockThresholdHa } from "@/domain/status";
import { consoleContext } from "@/lib/console";
import { describeEvent } from "@/lib/describe-event";
import { getPlotDetail } from "@/lib/queries";
import { acceptReview, removeFromLot } from "../../actions";

const SOURCE_NAME: Record<string, string> = {
  gfw_loss: "Tree cover loss after 2020",
  gfw_alerts: "Deforestation alerts",
  whisp: "Whisp",
};
const SOURCE_BY: Record<string, string> = {
  gfw_loss: "Global Forest Watch, University of Maryland",
  gfw_alerts: "Global Forest Watch integrated alerts",
  whisp: "FAO Open Foris",
};

export default function PlotPage({ params }: PageProps<"/plots/[ref]">) {
  return (
    <Suspense fallback={<div className="h-[640px] animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
      <PlotBody params={params} />
    </Suspense>
  );
}

async function PlotBody({ params }: { params: PageProps<"/plots/[ref]">["params"] }) {
  const { ref } = await params;
  const { db, orgId } = await consoleContext();
  const d = await getPlotDetail(db, orgId, decodeURIComponent(ref).toUpperCase());
  if (!d) notFound();
  const { plot, farmer, agent, checks, requests, lot, history } = d;
  const area = plot.areaHa ?? plot.declaredAreaHa ?? 0;
  // Checks arrive newest first; keep the newest per source.
  const latest = [...new Map([...checks].reverse().map((c) => [c.source, c] as const)).values()];
  const errors = plot.issues.filter((i) => i.severity === "error");
  const warnings = plot.issues.filter((i) => i.severity === "warning");
  const showMap = plot.geometry && !plot.issues.some((i) => i.code === "swapped_coordinates" || i.code === "out_of_bounds");
  const openRequests = requests.filter((r) => r.status === "open");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/plots", label: "All plots" }}
        title={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {plot.ref}
            <StatusBadge status={plot.status} accepted={plot.reviewAccepted} />
          </span>
        }
        description={
          <>
            {farmer.nameLatin ?? farmer.name}
            {farmer.nameLatin && farmer.name !== farmer.nameLatin ? <span lang="am" className="font-amharic"> ({farmer.name})</span> : null}, {farmer.village}
            {lot ? `, in lot ${lot.ref}` : ", not in a lot"}
          </>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {showMap ? (
            <PlotMap plots={[{ ref: plot.ref, status: plot.status, geometry: plot.geometry, highlight: true }]} height={440} focus />
          ) : (
            <Card className="grid h-56 place-items-center p-6 text-center text-sm text-ink-soft">
              This plot cannot be shown on the map until its location is fixed in the field.
            </Card>
          )}

          <Card aria-labelledby="evidence">
            <CardHeader id="evidence" title="Satellite evidence" meta={plot.agreement != null ? `Sources agree ${Math.round(plot.agreement * 100)}%` : undefined} />
            {latest.length === 0 ? (
              <p className="px-6 pt-2 pb-6 text-sm text-ink-soft">Not screened yet. {errors.length ? "The boundary has to be fixed first." : "Run today's checks from the overview."}</p>
            ) : (
              <ul className="mt-3 grid gap-px border-t border-hairline sm:grid-cols-2">
                {latest.map((c) => {
                  const flagged = c.available && (c.lossHa > 0 || c.alertCount > 0);
                  return (
                    <li key={c.id} className="flex flex-col gap-1.5 px-6 py-5">
                      <span className="text-[13px] text-ink-faint">{SOURCE_NAME[c.source] ?? c.source}</span>
                      <span className={`text-[22px] leading-tight font-light tracking-[-0.02em] ${!c.available ? "text-unchecked" : flagged ? "text-review" : "text-clear"}`}>
                        {!c.available
                          ? "No answer"
                          : c.source === "gfw_alerts"
                            ? c.alertCount
                              ? `${c.alertCount} alert${c.alertCount > 1 ? "s" : ""} since 2021`
                              : "No alerts since 2021"
                            : c.lossHa
                              ? `${c.lossHa.toFixed(2)} ha lost after 2020`
                              : "No loss after 2020"}
                      </span>
                      <span className="text-[12px] text-ink-faint">
                        {SOURCE_BY[c.source]}
                        {c.simulated ? ", simulated without an API key" : `, ${c.datasetVersion}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="border-t border-hairline px-6 py-4 text-[13px] leading-relaxed text-ink-soft">
              Blocked at {blockThresholdHa(area).toFixed(2)} ha of loss after 2020, the lower of 10% of this plot and 0.5 ha. Any smaller loss or any alert needs a person&apos;s review. Rules version {latest[0]?.rulesVersion ?? "2026-11-11.1"}.
            </p>
          </Card>

          <Card aria-labelledby="history">
            <CardHeader id="history" title="Ledger history" />
            <ol className="flex flex-col px-6 pt-4 pb-6">
              {history.length === 0 ? <li className="text-sm text-ink-soft">No events for this plot yet.</li> : null}
              {history.map((e, i) => (
                <li key={e.seq} className="relative flex gap-4 pb-4 last:pb-0">
                  <span className="relative flex w-2 justify-center" aria-hidden>
                    <span className="mt-1.5 size-2 rounded-full bg-hairline-strong" />
                    {i < history.length - 1 ? <span className="absolute top-4 bottom-[-4px] w-px bg-hairline" /> : null}
                  </span>
                  <span className="min-w-0 text-sm">
                    {describeEvent(e.type, e.payload)}
                    <span className="block text-[12px] text-ink-faint">
                      Entry {e.seq}, {new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}, hash {e.hash.slice(0, 12)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="flex flex-col gap-6 xl:sticky xl:top-12">
          {plot.status === "review" && !plot.reviewAccepted ? (
            <Card className="p-6 shadow-[0_0_0_1.5px_var(--color-review),var(--shadow-card)]">
              <ReasonForm
                plotRef={plot.ref}
                action={acceptReview}
                title="Accept after review"
                help="Accept only with evidence, such as a field photo showing shade-grown coffee. Your reason goes on the ledger."
                placeholder="Field photo shows mature shade trees over coffee; the loss is one fallen tree."
                submit="Accept plot"
                pendingLabel="Accepting"
              />
            </Card>
          ) : null}
          {plot.status === "blocked" && lot ? (
            <Card className="p-6 shadow-[0_0_0_1.5px_var(--color-blocked),var(--shadow-card)]">
              <ReasonForm
                plotRef={plot.ref}
                action={removeFromLot}
                title={`Remove from lot ${lot.ref}`}
                help="Its coffee will not ship in this lot, so the rest of the lot can. The reason goes on the ledger and the buyer sees it."
                placeholder="Loss confirmed in 2023 imagery; this farm's coffee is sold outside the EU."
                submit="Remove from lot"
                pendingLabel="Removing"
                tone="danger"
              />
            </Card>
          ) : null}

          <Card className="p-6">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
              <Fact label="Area">{area.toFixed(2)} ha</Fact>
              <Fact label="Shape">{plot.geometry?.type === "Point" ? "Point" : plot.geometry ? "Boundary" : "None"}</Fact>
              <Fact label="Lot">{lot ? `${lot.ref}, ${lot.state}` : "None"}</Fact>
              <Fact label="Field agent">{agent?.name.replace(" (synthetic)", "") ?? "None"}</Fact>
            </dl>
            {plot.reviewAccepted && plot.reviewReason ? (
              <p className="mt-5 border-t border-hairline pt-5 text-sm text-ink-soft">Accepted after review: &ldquo;{plot.reviewReason}&rdquo;</p>
            ) : null}
          </Card>

          <Card aria-labelledby="why">
            <CardHeader id="why" title="Why this status" />
            <ul className="flex flex-col gap-2 px-6 pt-3 pb-6 text-sm">
              {plot.statusReasons.length ? plot.statusReasons.map((r) => <li key={r}>{reasonText(r)}</li>) : <li>All sources clean.</li>}
              {errors.map((i) => (
                <li key={i.code} className="text-blocked">{i.message}</li>
              ))}
              {warnings.map((i) => (
                <li key={i.code} className="text-ink-soft">{i.message}</li>
              ))}
            </ul>
          </Card>

          <Card aria-labelledby="requests">
            <CardHeader id="requests" title="Field requests" meta={openRequests.length ? `${openRequests.length} open` : undefined} />
            {requests.length === 0 ? (
              <p className="px-6 pt-3 pb-6 text-sm text-ink-soft">None.</p>
            ) : (
              <ul className="flex flex-col gap-2 px-6 pt-3 pb-6 text-sm">
                {requests.map((g) => (
                  <li key={g.id} className="flex justify-between gap-3">
                    <span>{needText(g.need)}</span>
                    <span className={g.status === "open" ? "text-review" : "text-clear"}>
                      {g.status === "open" ? (g.reminders ? `Open, ${g.reminders} reminder${g.reminders > 1 ? "s" : ""}` : "Open") : "Done"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
