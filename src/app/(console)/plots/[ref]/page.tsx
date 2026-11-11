import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AcceptReview } from "@/components/accept-review";
import { PlotMap } from "@/components/plot-map";
import { StatusBadge, needText, reasonText } from "@/components/status";
import { blockThresholdHa } from "@/domain/status";
import { consoleContext } from "@/lib/console";
import { describeEvent } from "@/lib/describe-event";
import { getPlotDetail } from "@/lib/queries";

const SOURCE_NAME: Record<string, string> = {
  gfw_loss: "Tree cover loss after 2020 (Global Forest Watch, University of Maryland)",
  gfw_alerts: "Integrated deforestation alerts (Global Forest Watch)",
  whisp: "Whisp (FAO)",
};

export default function PlotPage({ params }: PageProps<"/plots/[ref]">) {
  return (
    <Suspense fallback={<p className="text-ink-soft">Loading plot…</p>}>
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

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link href="/plots" className="text-sm text-ink-soft hover:text-ink">All plots</Link>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{plot.ref}</h1>
          <StatusBadge status={plot.status} accepted={plot.reviewAccepted} />
        </div>
        <p className="text-ink-soft">
          {farmer.nameLatin}
          {farmer.name !== farmer.nameLatin ? <span lang="am" className="font-amharic"> ({farmer.name})</span> : null}, {farmer.village},{" "}
          {area.toFixed(2)} ha{lot ? `, in lot ${lot.ref}` : ""}. Field agent: {agent?.name.replace(" (synthetic)", "") ?? "none"}.
        </p>
      </header>

      <div className="grid gap-8 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          {showMap ? (
            <PlotMap plots={[{ ref: plot.ref, status: plot.status, geometry: plot.geometry, highlight: true }]} height={400} focus />
          ) : (
            <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-rule p-6 text-center text-ink-soft">
              This plot cannot be shown on the map until its location is fixed.
            </div>
          )}

          <section aria-labelledby="evidence" className="flex flex-col gap-3">
            <h2 id="evidence" className="text-xl font-semibold">Satellite evidence</h2>
            {latest.length === 0 ? (
              <p className="text-ink-soft">Not screened yet. {errors.length ? "Fix the boundary first." : "Run today's checks from the overview."}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-sheet">
                {latest.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                    <span className="font-medium">{SOURCE_NAME[c.source] ?? c.source}</span>
                    <span className={!c.available ? "text-unchecked" : c.lossHa > 0 || c.alertCount > 0 ? "text-review" : "text-clear"}>
                      {!c.available
                        ? "No answer from this source; the plot cannot be cleared without it."
                        : c.source === "gfw_alerts"
                          ? c.alertCount
                            ? `${c.alertCount} alert${c.alertCount > 1 ? "s" : ""} since 2021`
                            : "No alerts since 2021"
                          : c.lossHa
                            ? `${c.lossHa.toFixed(2)} ha of loss after 2020`
                            : "No tree cover loss after 2020"}
                    </span>
                    <span className="text-xs text-ink-soft">
                      Dataset {c.datasetVersion}, rules {c.rulesVersion}
                      {c.simulated ? ", simulated because no Global Forest Watch key is set" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-ink-soft">
              Rule for this plot: blocked at {blockThresholdHa(area).toFixed(2)} ha of loss after 2020 (the lower of 10% of its area and 0.5 ha). Any smaller loss or any alert needs a person&apos;s review.
              {plot.agreement != null ? ` Sources agree ${Math.round(plot.agreement * 100)}%.` : ""}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-8">
          {plot.status === "review" && !plot.reviewAccepted ? <AcceptReview plotRef={plot.ref} /> : null}
          {plot.reviewAccepted && plot.reviewReason ? (
            <p className="rounded-lg border border-rule bg-sheet p-4 text-sm">Accepted after review: &ldquo;{plot.reviewReason}&rdquo;</p>
          ) : null}

          <section aria-labelledby="why" className="flex flex-col gap-2">
            <h2 id="why" className="text-xl font-semibold">Why this status</h2>
            <ul className="list-disc pl-5 text-sm">
              {plot.statusReasons.length ? plot.statusReasons.map((r) => <li key={r}>{reasonText(r)}</li>) : <li>All sources clean.</li>}
              {errors.map((i) => <li key={i.code} className="text-blocked">{i.message}</li>)}
              {warnings.map((i) => <li key={i.code} className="text-ink-soft">{i.message}</li>)}
            </ul>
          </section>

          <section aria-labelledby="requests" className="flex flex-col gap-2">
            <h2 id="requests" className="text-xl font-semibold">Field requests</h2>
            {requests.length === 0 ? (
              <p className="text-sm text-ink-soft">None.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {requests.map((g) => (
                  <li key={g.id}>
                    {needText(g.need)}: <span className={g.status === "open" ? "text-review" : "text-clear"}>{g.status}</span>
                    {g.reminders ? <span className="text-ink-soft">, {g.reminders} reminder{g.reminders > 1 ? "s" : ""}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="history" className="flex flex-col gap-2">
            <h2 id="history" className="text-xl font-semibold">Ledger history</h2>
            <ol className="flex flex-col gap-2 border-l-2 border-rule pl-4 text-sm">
              {history.map((e) => (
                <li key={e.seq}>
                  {describeEvent(e.type, e.payload)}
                  <span className="block text-xs text-ink-soft">
                    Entry {e.seq}, {new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}, hash {e.hash.slice(0, 12)}
                  </span>
                </li>
              ))}
              {history.length === 0 ? <li className="text-ink-soft">No events for this plot yet.</li> : null}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
