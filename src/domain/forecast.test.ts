import { describe, expect, it } from "vitest";
import { forecastShipment } from "./forecast";
import { mulberry32 } from "./random";

const base = { now: "2026-11-11", shipDate: "2026-11-16", orgHistoryDays: [] as number[] };

describe("mulberry32", () => {
  it("is deterministic for a seed and stays in [0, 1)", () => {
    const a = mulberry32(7), b = mulberry32(7);
    const xs = Array.from({ length: 100 }, () => a());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("forecastShipment", () => {
  it("is certain and immediate with no open gaps", () => {
    const r = forecastShipment({ ...base, openGapsByAgent: {}, historyDaysByAgent: {} });
    expect(r).toMatchObject({ pOnTime: 1, p50: "2026-11-11", p90: "2026-11-11" });
  });

  it("gives identical results for identical inputs and seed", () => {
    const input = { ...base, openGapsByAgent: { a: 3 }, historyDaysByAgent: {}, orgHistoryDays: [1, 4, 6, 9] };
    expect(forecastShipment(input)).toEqual(forecastShipment(input));
  });

  it("is on time for a fast field agent and late for a slow one", () => {
    expect(forecastShipment({ ...base, openGapsByAgent: { a: 2 }, historyDaysByAgent: { a: [1, 1, 1] } }).pOnTime).toBe(1);
    expect(forecastShipment({ ...base, openGapsByAgent: { a: 2 }, historyDaysByAgent: { a: [10, 10, 10] } }).pOnTime).toBe(0);
  });

  it("falls back from agent history to org history to a prior", () => {
    const r = forecastShipment({
      ...base,
      openGapsByAgent: { a: 1, b: 1, c: 1 },
      historyDaysByAgent: { a: [2, 3, 4], b: [2] },
      orgHistoryDays: [],
    });
    expect(r.basis).toEqual({ a: "agent", b: "prior", c: "prior" });
    const r2 = forecastShipment({ ...base, openGapsByAgent: { b: 1 }, historyDaysByAgent: { b: [2] }, orgHistoryDays: [1, 2, 3] });
    expect(r2.basis).toEqual({ b: "org" });
  });

  it("gets later as an agent's backlog grows", () => {
    const hist = { a: [1, 2, 3, 4, 5, 6, 7, 8] };
    const few = forecastShipment({ ...base, openGapsByAgent: { a: 1 }, historyDaysByAgent: hist });
    const many = forecastShipment({ ...base, openGapsByAgent: { a: 10 }, historyDaysByAgent: hist });
    expect(many.pOnTime).toBeLessThan(few.pOnTime);
    expect(many.p50 >= few.p50).toBe(true);
  });

  it("orders p50 before or on p90 and reports the run count", () => {
    const r = forecastShipment({ ...base, openGapsByAgent: { a: 4 }, historyDaysByAgent: { a: [1, 3, 5, 9, 14] } });
    expect(r.p50 <= r.p90).toBe(true);
    expect(r.runs).toBe(10_000);
  });
});
