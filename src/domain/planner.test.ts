import { describe, expect, it } from "vitest";
import { mulberry32 } from "./random";
import { gradeNumber, planContainers, qualifies, scoreCurrent, type PlanLot, type PlanShipment } from "./planner";

const ships: PlanShipment[] = [
  { id: "HAM", ref: "HAM", volumeKg: 19_200, gradeRequired: "G1" },
  { id: "ANR", ref: "ANR", volumeKg: 19_200, gradeRequired: "G2" },
];
const lot = (id: string, grade: string, current: string | null, p: number, value = 57_600): PlanLot => ({
  id,
  ref: id,
  grade,
  kg: 9_600,
  valueUsd: value,
  currentShipmentId: current,
  pReady: { HAM: p, ANR: p },
});

describe("grades", () => {
  it("reads grade numbers and lets better grades fill lower contracts", () => {
    expect(gradeNumber("Guji washed G2")).toBe(2);
    expect(qualifies({ grade: "G1" }, { gradeRequired: "G2" })).toBe(true);
    expect(qualifies({ grade: "G2" }, { gradeRequired: "G1" })).toBe(false);
  });
});

describe("planContainers", () => {
  it("keeps a plan that already works", () => {
    const lots = [lot("A", "G1", "HAM", 1), lot("B", "G1", "HAM", 1), lot("C", "G1", "ANR", 1), lot("D", "G2", "ANR", 1)];
    const plan = planContainers({ shipments: ships, lots });
    expect(plan.changes).toEqual([]);
    expect(plan.pOnTime).toEqual({ HAM: 1, ANR: 1 });
  });

  it("swaps a held lot for a ready spare with the smallest change", () => {
    const lots = [lot("A", "G1", "HAM", 1), lot("B", "G1", "HAM", 1), lot("C", "G1", "ANR", 1), lot("D", "G2", "ANR", 0.1), lot("S", "G2", null, 0.95)];
    const plan = planContainers({ shipments: ships, lots });
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes).toContainEqual({ lotId: "S", lotRef: "S", from: null, to: "ANR" });
    expect(plan.changes).toContainEqual({ lotId: "D", lotRef: "D", from: "ANR", to: null });
    expect(plan.pOnTime.ANR).toBeCloseTo(0.95);
    expect(scoreCurrent({ shipments: ships, lots }).ANR).toBeCloseTo(0.1);
  });

  it("never puts a G2 lot in a G1 contract", () => {
    const lots = [lot("A", "G1", "HAM", 0.1), lot("B", "G1", "HAM", 1), lot("X", "G2", null, 1), lot("Y", "G2", null, 1)];
    const plan = planContainers({ shipments: ships, lots });
    expect(plan.allocation.HAM).not.toContain("X");
    expect(plan.allocation.HAM).not.toContain("Y");
  });

  it("reports a contract it cannot fill", () => {
    const plan = planContainers({ shipments: ships, lots: [lot("A", "G1", "HAM", 1)] });
    expect(plan.filled.HAM || plan.filled.ANR).toBe(false);
  });

  it("matches brute force on random instances and always meets volume and grade", () => {
    const rand = mulberry32(7);
    for (let n = 0; n < 40; n++) {
      const lots: PlanLot[] = Array.from({ length: 6 }, (_, i) =>
        lot(`L${i}`, rand() < 0.5 ? "G1" : "G2", rand() < 0.5 ? (rand() < 0.5 ? "HAM" : "ANR") : null, Math.round(rand() * 100) / 100, 50_000 + Math.round(rand() * 10_000)),
      );
      const plan = planContainers({ shipments: ships, lots });
      for (const s of ships) {
        const chosen = lots.filter((l) => plan.allocation[s.id].includes(l.id));
        chosen.forEach((l) => expect(qualifies(l, s)).toBe(true));
        if (plan.filled[s.id]) expect(chosen.reduce((t, l) => t + l.kg, 0)).toBeGreaterThanOrEqual(s.volumeKg);
      }
      expect(plan.expectedOnTime).toBeCloseTo(bruteForce(lots), 2);
    }
  });
});

function bruteForce(lots: PlanLot[]): number {
  let best = 0;
  const opts = ["HAM", "ANR", null] as const;
  const total = 3 ** lots.length;
  for (let code = 0; code < total; code++) {
    let c = code;
    const kg: Record<string, number> = { HAM: 0, ANR: 0 };
    const p: Record<string, number> = { HAM: 1, ANR: 1 };
    let ok = true;
    for (const l of lots) {
      const choice = opts[c % 3];
      c = Math.floor(c / 3);
      if (!choice) continue;
      const s = ships.find((x) => x.id === choice)!;
      if (!qualifies(l, s)) ok = false;
      kg[choice] += l.kg;
      p[choice] *= l.pReady[choice];
    }
    if (!ok) continue;
    const value = ships.reduce((t, s) => t + (kg[s.id] >= s.volumeKg && kg[s.id] <= s.volumeKg + 1_200 ? p[s.id] : 0), 0);
    best = Math.max(best, value);
  }
  return best;
}
