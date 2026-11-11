import Link from "next/link";
import { Suspense } from "react";
import { PlotMap } from "@/components/plot-map";
import { Segmented } from "@/components/segmented";
import { STATUS_BG, STATUS_LABEL, StatusBadge } from "@/components/status";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import type { PlotStatus } from "@/domain/types";
import { consoleContext } from "@/lib/console";
import { getPlots } from "@/lib/queries";

export const metadata = { title: "Plots" };

const STATUSES: PlotStatus[] = ["clear", "review", "blocked", "not_checked"];

export default function PlotsPage({ searchParams }: PageProps<"/plots">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Plots" description="Every farm plot behind your EU lots, on cloud-free satellite imagery. Select a plot to see its evidence." />
      <Suspense fallback={<div className="h-[520px] animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <PlotsBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PlotsBody({ searchParams }: { searchParams: PageProps<"/plots">["searchParams"] }) {
  const params = await searchParams;
  const view = params.view === "table" ? "table" : "map";
  const status = STATUSES.includes(params.status as PlotStatus) ? (params.status as PlotStatus) : null;
  const { db, orgId } = await consoleContext();
  const all = await getPlots(db, orgId);
  const rows = status ? all.filter((p) => p.status === status) : all;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((p) => p.status === s).length])) as Record<PlotStatus, number>;
  const href = (next: { view?: string; status?: string | null }) => {
    const q = new URLSearchParams();
    const v = next.view ?? view;
    const s = next.status === undefined ? status : next.status;
    if (v !== "map") q.set("view", v);
    if (s) q.set("status", s);
    return `/plots${q.size ? `?${q}` : ""}`;
  };
  const mappable = rows.filter((p) => p.geometry && !p.issues.some((i) => i.code === "swapped_coordinates" || i.code === "out_of_bounds"));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-1.5" aria-label="Filter by status">
          <li>
            <Link
              href={href({ status: null })}
              aria-current={!status ? "true" : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${!status ? "bg-ink text-white" : "bg-surface text-ink-soft shadow-[var(--shadow-card)] hover:text-ink"}`}
            >
              All <span className="tabular-nums opacity-70">{all.length}</span>
            </Link>
          </li>
          {STATUSES.map((s) => (
            <li key={s}>
              <Link
                href={href({ status: s })}
                aria-current={status === s ? "true" : undefined}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${status === s ? "bg-ink text-white" : "bg-surface text-ink-soft shadow-[var(--shadow-card)] hover:text-ink"}`}
              >
                <span className={`size-1.5 rounded-full ${STATUS_BG[s]}`} aria-hidden />
                {STATUS_LABEL[s]} <span className="tabular-nums opacity-70">{counts[s]}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Segmented
          label="View"
          value={view}
          options={[
            { value: "map", label: "Map", href: href({ view: "map" }) },
            { value: "table", label: "Table", href: href({ view: "table" }) },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No plots with this status">Choose another filter, or run today&apos;s checks from the overview.</EmptyState>
      ) : view === "map" ? (
        <PlotMap plots={mappable.map((p) => ({ ref: p.ref, status: p.status, geometry: p.geometry }))} height={560} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <caption className="sr-only">Plots{status ? ` with status ${STATUS_LABEL[status]}` : ""}</caption>
              <thead className="text-[13px] text-ink-faint">
                <tr className="border-b border-hairline">
                  <th scope="col" className="px-6 py-3 font-medium">Plot</th>
                  <th scope="col" className="px-4 py-3 font-medium">Farmer</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Area</th>
                  <th scope="col" className="px-6 py-3 font-medium">Shape</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const error = p.issues.find((i) => i.severity === "error");
                  return (
                    <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-page">
                      <td className="px-6 py-3">
                        <Link href={`/plots/${p.ref}`} className="font-medium text-ink hover:text-leaf">{p.ref}</Link>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{p.farmer ?? "Name in Amharic"}</td>
                      <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-soft">{(p.areaHa ?? p.declaredAreaHa ?? 0).toFixed(2)} ha</td>
                      <td className={`px-6 py-3 ${error ? "text-blocked" : "text-ink-soft"}`}>
                        {error ? error.message : p.geometry?.type === "Point" ? "Point" : "Walked boundary"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
