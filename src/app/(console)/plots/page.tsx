import Link from "next/link";
import { Suspense } from "react";
import { PlotMap } from "@/components/plot-map";
import { StatusBadge } from "@/components/status";
import { consoleContext } from "@/lib/console";
import { getPlots } from "@/lib/queries";

export const metadata = { title: "Plots" };

export default function PlotsPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Plots</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Every farm plot behind your EU lots, on cloud-free satellite imagery. Select a plot to see its evidence.
        </p>
      </header>
      <Suspense fallback={<p className="text-ink-soft">Loading plots…</p>}>
        <PlotsBody />
      </Suspense>
    </div>
  );
}

async function PlotsBody() {
  const { db, orgId } = await consoleContext();
  const rows = await getPlots(db, orgId);
  const mappable = rows.filter((p) => p.geometry && !p.issues.some((i) => i.code === "swapped_coordinates" || i.code === "out_of_bounds"));
  return (
    <>
      <PlotMap plots={mappable.map((p) => ({ ref: p.ref, status: p.status, geometry: p.geometry }))} height={460} />
      <div className="overflow-x-auto rounded-lg border border-rule bg-sheet">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">All plots</caption>
          <thead className="border-b border-rule text-ink-soft">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Plot</th>
              <th scope="col" className="px-4 py-3 font-medium">Farmer</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Area</th>
              <th scope="col" className="px-4 py-3 font-medium">Shape</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {rows.map((p) => {
              const errors = p.issues.filter((i) => i.severity === "error");
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/plots/${p.ref}`} className="font-medium text-canopy underline-offset-2 hover:underline">{p.ref}</Link>
                  </td>
                  <td className="px-4 py-2.5">{p.farmer}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(p.areaHa ?? p.declaredAreaHa ?? 0).toFixed(2)} ha</td>
                  <td className={`px-4 py-2.5 ${errors.length ? "text-blocked" : "text-ink-soft"}`}>
                    {errors.length ? errors[0].message : p.geometry?.type === "Point" ? "Point" : "Boundary"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
