import Link from "next/link";
import type { PlotTile } from "@/lib/queries";
import { STATUS_BG, STATUS_LABEL } from "./status";

/**
 * Kaffa's signature view: every plot behind a lot as one tile, coloured by status.
 * A tile with an open field request carries a ring, because it still holds the lot.
 */
export function PlotStrip({ plots, animate = false, link = true }: { plots: PlotTile[]; animate?: boolean; link?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-[5px]" aria-label="Plots in this lot">
      {plots.map((p, i) => {
        const label = `${p.ref}: ${STATUS_LABEL[p.status]}${p.status === "review" && p.reviewAccepted ? " (accepted)" : ""}${p.openRequests ? ", field request open" : ""}`;
        const className = `block size-[18px] rounded-[var(--radius-tile)] ${STATUS_BG[p.status]} ${p.status === "review" && p.reviewAccepted ? "opacity-50" : ""} ${p.openRequests ? "ring-[1.5px] ring-ink ring-offset-[1.5px] ring-offset-surface" : ""} ${animate ? "tile-settle" : ""} ${link ? "transition-transform hover:scale-[1.25]" : ""}`;
        const style = animate ? { animationDelay: `${i * 16}ms` } : undefined;
        return (
          <li key={p.id}>
            {link ? (
              <Link href={`/plots/${p.ref}`} title={label} aria-label={label} className={className} style={style} />
            ) : (
              <span role="img" title={label} aria-label={label} className={className} style={style} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
