import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { createGfwClient } from "./gfw";

const square: Polygon = {
  type: "Polygon",
  coordinates: [[[38.2, 6.16], [38.201, 6.16], [38.201, 6.161], [38.2, 6.161], [38.2, 6.16]]],
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("createGfwClient (live)", () => {
  it("queries tree cover loss after the cut-off with the key and origin headers", async () => {
    const { f, calls } = fakeFetch(200, {
      status: "success",
      data: [
        { umd_tree_cover_loss__year: 2022, area__ha: 0.12 },
        { umd_tree_cover_loss__year: 2024, area__ha: 0.05 },
      ],
    });
    const gfw = createGfwClient({ apiKey: "k1", origin: "kaffa.example", fetch: f });
    const r = await gfw.treeCoverLoss(square);

    expect(r).toMatchObject({ source: "gfw_loss", available: true, alertCount: 0 });
    expect(r.lossHa).toBeCloseTo(0.17);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k1");
    expect(headers.origin).toBe("https://kaffa.example");
    expect(calls[0].url).toContain("/dataset/umd_tree_cover_loss/");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.sql).toContain(">= 2021");
    expect(body.geometry).toEqual(square);
    expect(gfw.simulated).toBe(false);
  });

  it("counts integrated deforestation alerts since a date", async () => {
    const { f, calls } = fakeFetch(200, { status: "success", data: [{ alert_count: 3, area__ha: 0.02 }] });
    const r = await createGfwClient({ apiKey: "k1", fetch: f }).integratedAlerts(square, "2021-01-01");
    expect(r).toMatchObject({ source: "gfw_alerts", available: true, alertCount: 3 });
    expect(JSON.parse(String(calls[0].init.body)).sql).toContain("'2021-01-01'");
  });

  it("reports a source as unavailable when rate limited or down", async () => {
    const { f } = fakeFetch(429, { status: "failed" });
    const r = await createGfwClient({ apiKey: "k1", fetch: f }).treeCoverLoss(square);
    expect(r).toMatchObject({ available: false, lossHa: 0 });
  });
});

describe("createGfwClient (simulated)", () => {
  it("returns deterministic, labelled results without a key", async () => {
    const gfw = createGfwClient({});
    expect(gfw.simulated).toBe(true);
    const a = await gfw.treeCoverLoss(square);
    const b = await gfw.treeCoverLoss(square);
    expect(a).toEqual(b);
    expect(a.available).toBe(true);
    expect(a.datasetVersion).toContain("simulated");
  });
});
