/**
 * Container planner. Allocates lots to shipments so each contract's volume and grade are
 * met, maximising the expected number of shipments that leave on time, then value, while
 * moving as few lots as possible from the current plan.
 *
 * Exact branch-and-bound over lot assignments. An exporter's open season is a handful of
 * shipments and up to a few dozen lots, which this solves in milliseconds; a MIP solver
 * is the drop-in for larger books (see docs/decisions.md).
 */

export type PlanShipment = { id: string; ref: string; volumeKg: number; gradeRequired: string };
export type PlanLot = {
  id: string;
  ref: string;
  grade: string;
  kg: number;
  valueUsd: number;
  currentShipmentId: string | null;
  /** Probability the lot is ready by each shipment's ship date. */
  pReady: Record<string, number>;
};

export type Plan = {
  allocation: Record<string, string[]>;
  pOnTime: Record<string, number>;
  filled: Record<string, boolean>;
  changes: { lotId: string; lotRef: string; from: string | null; to: string | null }[];
  expectedOnTime: number;
  explored: number;
};

/** "Guji natural G1" → 1; no grade → 9. */
export function gradeNumber(grade: string): number {
  const m = /G\s*(\d)/i.exec(grade);
  return m ? Number(m[1]) : 9;
}

export function qualifies(lot: Pick<PlanLot, "grade">, shipment: Pick<PlanShipment, "gradeRequired">): boolean {
  return gradeNumber(lot.grade) <= gradeNumber(shipment.gradeRequired);
}

const CHANGE_PENALTY = 0.002;
const VALUE_WEIGHT = 1e-8;
/** A shipment may be over-filled by at most this much, so a lot is never split. */
const MAX_OVER_KG = 1_200;

export function planContainers(input: { shipments: PlanShipment[]; lots: PlanLot[]; maxNodes?: number }): Plan {
  const { shipments, lots } = input;
  const maxNodes = input.maxNodes ?? 2_000_000;
  // Most valuable choices first, so good solutions are found early and pruning bites.
  const order = [...lots].sort((a, b) => b.kg - a.kg || b.valueUsd - a.valueUsd);
  const choices = order.map((lot) => [
    ...shipments.filter((s) => qualifies(lot, s)).map((s) => s.id),
    null,
  ]);
  const remainingKg = order.map((_, i) => order.slice(i).reduce((s, l) => s + l.kg, 0));

  const kg: Record<string, number> = Object.fromEntries(shipments.map((s) => [s.id, 0]));
  const prob: Record<string, number> = Object.fromEntries(shipments.map((s) => [s.id, 1]));
  const assign: (string | null)[] = new Array(order.length).fill(null);
  let best: { score: number; assign: (string | null)[] } = { score: -Infinity, assign: [...assign] };
  let explored = 0;

  const score = () => {
    let s = 0;
    for (const sh of shipments) if (kg[sh.id] >= sh.volumeKg) s += prob[sh.id];
    order.forEach((l, i) => {
      if (assign[i]) s += VALUE_WEIGHT * l.valueUsd;
      if (assign[i] !== l.currentShipmentId) s -= CHANGE_PENALTY;
    });
    return s;
  };

  const upperBound = (i: number) => {
    // Every unfilled shipment that could still be filled scores at most its current probability.
    let s = 0;
    for (const sh of shipments) if (kg[sh.id] >= sh.volumeKg || kg[sh.id] + remainingKg[i] >= sh.volumeKg) s += prob[sh.id];
    return s + VALUE_WEIGHT * order.reduce((t, l) => t + l.valueUsd, 0);
  };

  const visit = (i: number) => {
    if (++explored > maxNodes) return;
    if (i === order.length) {
      const s = score();
      if (s > best.score) best = { score: s, assign: [...assign] };
      return;
    }
    if (upperBound(i) < best.score) return;
    const lot = order[i];
    for (const choice of choices[i]) {
      if (choice) {
        const sh = shipments.find((x) => x.id === choice)!;
        if (kg[choice] + lot.kg > sh.volumeKg + MAX_OVER_KG) continue;
        if (kg[choice] >= sh.volumeKg) continue; // already full; adding only wastes a lot
        const prevProb = prob[choice];
        kg[choice] += lot.kg;
        prob[choice] *= lot.pReady[choice] ?? 0;
        assign[i] = choice;
        visit(i + 1);
        kg[choice] -= lot.kg;
        prob[choice] = prevProb;
      } else {
        assign[i] = null;
        visit(i + 1);
      }
    }
    assign[i] = null;
  };
  visit(0);

  const allocation: Record<string, string[]> = Object.fromEntries(shipments.map((s) => [s.id, []]));
  const pOnTime: Record<string, number> = {};
  const filled: Record<string, boolean> = {};
  best.assign.forEach((sid, i) => sid && allocation[sid].push(order[i].id));
  for (const sh of shipments) {
    const chosen = lots.filter((l) => allocation[sh.id].includes(l.id));
    filled[sh.id] = chosen.reduce((s, l) => s + l.kg, 0) >= sh.volumeKg;
    pOnTime[sh.id] = filled[sh.id] ? round3(chosen.reduce((p, l) => p * (l.pReady[sh.id] ?? 0), 1)) : 0;
    allocation[sh.id] = chosen.map((l) => l.id);
  }
  const changes = order
    .map((l, i) => ({ lotId: l.id, lotRef: l.ref, from: l.currentShipmentId, to: best.assign[i] }))
    .filter((c) => c.from !== c.to);
  return { allocation, pOnTime, filled, changes, expectedOnTime: round3(Object.values(pOnTime).reduce((a, b) => a + b, 0)), explored };
}

/** The current allocation scored the same way, for a before-and-after comparison. */
export function scoreCurrent(input: { shipments: PlanShipment[]; lots: PlanLot[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sh of input.shipments) {
    const chosen = input.lots.filter((l) => l.currentShipmentId === sh.id);
    const full = chosen.reduce((s, l) => s + l.kg, 0) >= sh.volumeKg;
    out[sh.id] = full ? round3(chosen.reduce((p, l) => p * (l.pReady[sh.id] ?? 0), 1)) : 0;
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
