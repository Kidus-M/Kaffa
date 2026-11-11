"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MlMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";

/** EOX Sentinel-2 cloudless yearly mosaics, CC BY-NC-SA 4.0, https://cloudless.eox.at */
const eox = (year: number) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/g/{z}/{y}/{x}.jpg`;
// Turbopack does not bundle MapLibre's worker; it is copied to public/ on install.
setWorkerUrl("/maplibre-gl-worker.mjs");

const BEFORE = 2020;
const AFTER = 2025;

const STATUS_COLOR = {
  clear: "#2e7a4c",
  review: "#c48514",
  blocked: "#b0263a",
  not_checked: "#8b938e",
} as const;

export type MapPlot = { ref: string; status: keyof typeof STATUS_COLOR; geometry: GeoJSON.Geometry | null; highlight?: boolean };

function toCollection(plots: MapPlot[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: plots
      .filter((p) => p.geometry)
      .map((p) => ({ type: "Feature", properties: { ref: p.ref, color: STATUS_COLOR[p.status], highlight: p.highlight ? 1 : 0 }, geometry: p.geometry! })),
  };
}

function bounds(fc: FeatureCollection): [number, number, number, number] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      xs.push(c[0] as number);
      ys.push(c[1] as number);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  fc.features.forEach((f) => walk((f.geometry as { coordinates: unknown }).coordinates));
  if (!xs.length) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function PlotMap({ plots, height = 420, focus = false }: { plots: MapPlot[]; height?: number; focus?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const router = useRouter();
  const [mix, setMix] = useState(100);
  const sliderId = useId();

  useEffect(() => {
    if (!container.current) return;
    const data = toCollection(plots);
    const m = new MlMap({
      container: container.current,
      style: {
        version: 8,
        sources: {
          before: { type: "raster", tiles: [eox(BEFORE)], tileSize: 256, maxzoom: 14, attribution: `Sentinel-2 cloudless ${BEFORE}, ${AFTER} by EOX IT Services GmbH (contains modified Copernicus Sentinel data)` },
          after: { type: "raster", tiles: [eox(AFTER)], tileSize: 256, maxzoom: 14 },
          plots: { type: "geojson", data },
        },
        layers: [
          { id: "before", type: "raster", source: "before" },
          { id: "after", type: "raster", source: "after", paint: { "raster-opacity": 1 } },
          { id: "plot-fill", type: "fill", source: "plots", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.28 } },
          {
            id: "plot-line",
            type: "line",
            source: "plots",
            filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
            paint: { "line-color": ["case", ["==", ["get", "highlight"], 1], "#ffffff", ["get", "color"]], "line-width": ["case", ["==", ["get", "highlight"], 1], 3, 2] },
          },
          {
            id: "plot-point",
            type: "circle",
            source: "plots",
            filter: ["==", ["geometry-type"], "Point"],
            paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
          },
        ],
      },
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const box = bounds(data);
    if (box) m.fitBounds(box, { padding: focus ? 120 : 40, maxZoom: focus ? 15 : 14, duration: 0 });
    for (const layer of ["plot-fill", "plot-point"]) {
      m.on("click", layer, (e: MapLayerMouseEvent) => {
        const ref = e.features?.[0]?.properties?.ref;
        if (ref) router.push(`/plots/${ref}`);
      });
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // Rebuild only when the plot set changes; status colours update through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plots.length, focus]);

  useEffect(() => {
    const src = map.current?.getSource("plots") as GeoJSONSource | undefined;
    src?.setData(toCollection(plots));
  }, [plots]);

  useEffect(() => {
    const m = map.current;
    if (m?.getLayer("after")) m.setPaintProperty("after", "raster-opacity", mix / 100);
  }, [mix]);

  return (
    <figure className="relative">
      <div ref={container} style={{ height }} className="w-full overflow-hidden rounded-[var(--radius-card)] bg-ink shadow-[var(--shadow-card)]" />
      <figcaption className="absolute bottom-3 left-3 flex items-center gap-3 rounded-full bg-surface/95 px-4 py-2 text-[13px] text-ink-soft shadow-[var(--shadow-float)] backdrop-blur">
        <label htmlFor={sliderId} className="font-medium text-ink">
          Imagery
        </label>
        <span className="tabular-nums">{BEFORE}</span>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          value={mix}
          onChange={(e) => setMix(Number(e.target.value))}
          className="w-28 accent-[var(--color-leaf)] sm:w-36"
          aria-valuetext={mix < 50 ? `Mostly ${BEFORE}, the EU cut-off year` : `Mostly ${AFTER}`}
          title={`Drag toward ${BEFORE} to see the land at the EU cut-off date`}
        />
        <span className="tabular-nums">{AFTER}</span>
      </figcaption>
    </figure>
  );
}
