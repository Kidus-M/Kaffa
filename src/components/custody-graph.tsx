/**
 * The custody graph as a flow diagram: plots on the left, then collectors, washing
 * stations, the lot and its shipment. Edge width is proportional to kilograms, so a
 * supplier delivering far more than its neighbours stands out before any number is read.
 * Rendered on the server as SVG: no client code, readable by screen readers as a list.
 */
import type { GraphEdge, GraphNode } from "@/domain/custody";

const COLUMNS: GraphNode["kind"][] = ["plot", "collector", "washing_station", "lot", "shipment"];
const COLUMN_LABEL: Record<GraphNode["kind"], string> = {
  plot: "Farms",
  collector: "Collectors",
  washing_station: "Washing stations",
  lot: "Lot",
  shipment: "Shipment",
};
const W = 960;
const NODE_W = 150;
const ROW = 40;
const TOP = 36;

export function CustodyGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const cols = COLUMNS.filter((k) => nodes.some((n) => n.kind === k));
  const rows = Math.max(...cols.map((k) => nodes.filter((n) => n.kind === k).length));
  const height = TOP + rows * ROW + 12;
  const colX = (i: number) => (cols.length === 1 ? 0 : (i * (W - NODE_W)) / (cols.length - 1));
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((k, ci) => {
    const list = nodes.filter((n) => n.kind === k);
    const offset = ((rows - list.length) * ROW) / 2;
    list.forEach((n, i) => pos.set(n.id, { x: colX(ci), y: TOP + offset + i * ROW + ROW / 2 }));
  });
  const maxKg = Math.max(1, ...edges.map((e) => e.kg));
  const width = (kg: number) => Math.max(1.5, (kg / maxKg) * 16);
  const flagged = new Set(nodes.filter((n) => n.flagged).map((n) => n.id));

  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full min-w-[640px]" role="img" aria-label="Custody graph from farms to shipment">
          {cols.map((k, ci) => (
            <text key={k} x={colX(ci) + 4} y={14} className="fill-ink-faint text-[12px]">
              {COLUMN_LABEL[k]}
            </text>
          ))}
          {edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const x2 = b.x;
            const mid = (x1 + x2) / 2;
            const bad = flagged.has(e.from);
            return (
              <path
                key={`${e.from}>${e.to}`}
                d={`M${x1},${a.y} C${mid},${a.y} ${mid},${b.y} ${x2},${b.y}`}
                fill="none"
                strokeWidth={width(e.kg)}
                strokeLinecap="round"
                className={bad ? "stroke-blocked/45" : "stroke-leaf/25"}
              >
                <title>{`${e.kg.toLocaleString()} kg`}</title>
              </path>
            );
          })}
          {nodes.map((n) => {
            const p = pos.get(n.id)!;
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y - 15})`}>
                <rect
                  width={NODE_W}
                  height={30}
                  rx={15}
                  className={n.flagged ? "fill-blocked-wash stroke-blocked" : n.kind === "lot" || n.kind === "shipment" ? "fill-ink stroke-ink" : "fill-surface stroke-hairline-strong"}
                  strokeWidth={1}
                />
                <text x={14} y={19.5} className={`text-[12.5px] ${n.kind === "lot" || n.kind === "shipment" ? "fill-white font-medium" : n.flagged ? "fill-blocked font-medium" : "fill-ink"}`}>
                  {truncate(n.label, n.sub ? 13 : 20)}
                  {n.sub ? <tspan className={n.flagged ? "fill-blocked" : "fill-ink-faint"}> {n.sub}</tspan> : null}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="text-[12px] text-ink-faint">Line width shows kilograms delivered. Red marks a supplier the auditor flagged.</figcaption>
      <ul className="sr-only">
        {edges.map((e) => (
          <li key={`${e.from}>${e.to}`}>
            {nodes.find((n) => n.id === e.from)?.label} to {nodes.find((n) => n.id === e.to)?.label}: {e.kg} kg
          </li>
        ))}
      </ul>
    </figure>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
