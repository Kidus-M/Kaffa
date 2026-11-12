/**
 * The agent evaluation suite. Runs every golden set, prints a scorecard, and exits non-zero
 * when a score falls below its threshold or more than 0.01 below the committed baseline.
 * Sets that need Gemini run only when GEMINI_API_KEY is set (a CI secret); the rest are
 * deterministic and always run.
 *
 *   npm run evals                 score and gate
 *   npm run evals -- --baseline   also write the current scores as the new baseline
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extractEmail, readEmailByRules } from "@/agents/email";
import { extractReply } from "@/agents/field-liaison";
import { parseCsv } from "@/agents/intake";
import { createPgliteDb } from "@/db/client";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";
import { scorePair } from "@/domain/identity";
import { gradeNumber, planContainers, qualifies, type PlanLot, type PlanShipment } from "@/domain/planner";
import { mulberry32 } from "@/domain/random";
import { checkCitations } from "@/domain/retrieval";
import { estimateMatrix, solveTour, tourMinutes, type LonLat } from "@/domain/route";
import { MERGE_PROPOSE_SCORE } from "@/config/policy";
import { createGemini } from "@/integrations/gemini";
import { askQuestion } from "@/services/copilot";
import { COPILOT_QUESTIONS, EMAILS, IDENTITY_PAIRS, REPLIES } from "../evals/sets";

const scores: Record<string, number> = {};
const notes: string[] = [];
const gemini = createGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || "gemini-3.5-flash,gemini-3.5-flash-lite" });

// Identity resolution: precision and recall of proposed merges.
{
  let tp = 0, fp = 0, fn = 0;
  for (const pair of IDENTITY_PAIRS) {
    const predicted = scorePair(pair.a, pair.b).score >= MERGE_PROPOSE_SCORE;
    if (predicted && pair.same) tp++;
    else if (predicted) {
      fp++;
      notes.push(`identity false match: ${pair.note}`);
    } else if (pair.same) {
      fn++;
      notes.push(`identity missed: ${pair.note}`);
    }
  }
  scores["identity.precision"] = tp + fp ? tp / (tp + fp) : 1;
  scores["identity.recall"] = tp + fn ? tp / (tp + fn) : 1;
}

// Intake: every field of the sample register, parsed exactly.
{
  const rows = parseCsv(readFileSync("public/samples/konga-register.csv", "utf8"));
  const expected = [
    { farmerName: "Mekdes Worku", village: "Konga", areaHa: 1.1, lat: 6.104321, lon: 38.214321 },
    { farmerName: "ብርሃኑ ታደሰ", village: "Konga", areaHa: 0.85, lat: 6.098765, lon: 38.209876 },
    { farmerName: "Selam Getachew", village: "Konga", areaHa: null, lat: 6.097654, lon: 38.218765 },
    { farmerName: "Yonas Alemayehu", village: "Konga", areaHa: 0.6, lat: 38.221234, lon: 6.093456 },
    { farmerName: "Hana Desta", village: "Konga", areaHa: 2.4, lat: 6.091234, lon: 38.205678 },
    { farmerName: "Tesfaie Girma", village: "Konga", areaHa: 1.3, lat: 6.1012, lon: 38.219 },
  ];
  let right = 0, total = 0;
  expected.forEach((e, i) => {
    for (const [k, v] of Object.entries(e)) {
      total++;
      const got = (rows[i] as unknown as Record<string, { value: unknown; confidence: number }>)?.[k];
      const ok = v === null ? got?.value == null || got.confidence === 0 : got?.value === v;
      if (ok) right++;
      else notes.push(`intake row ${i + 1} ${k}: expected ${v}, got ${JSON.stringify(got)}`);
    }
  });
  scores["intake.csv_field_accuracy"] = right / total;
}

// Email intake: rule reader always; Gemini when a key is present.
async function emailAccuracy(read: (e: (typeof EMAILS)[number]["email"]) => Promise<ReturnType<typeof readEmailByRules>>, label: string) {
  let right = 0, total = 0;
  for (const { email, expect } of EMAILS) {
    const r = await read(email);
    const checks: [string, boolean][] = [["kind", r.kind === expect.kind]];
    if (expect.ref) checks.push(["ref", r.contract?.ref === expect.ref]);
    if (expect.volumeKg) checks.push(["volume", r.contract?.volumeKg === expect.volumeKg]);
    if (expect.grade) checks.push(["grade", `G${gradeNumber(r.contract?.grade ?? "")}` === expect.grade]);
    if (expect.port) checks.push(["port", r.contract?.destinationPort === expect.port]);
    if (expect.shipDate) checks.push(["date", r.contract?.shipDate === expect.shipDate]);
    if (expect.questionIncludes) checks.push(["question", Boolean(r.question?.toLowerCase().includes(expect.questionIncludes))]);
    for (const [k, ok] of checks) {
      total++;
      if (ok) right++;
      else notes.push(`${label} "${email.subject}": ${k} wrong`);
    }
  }
  return right / total;
}
scores["email.rules_field_accuracy"] = await emailAccuracy(async (e) => readEmailByRules(e), "email rules");
if (gemini) scores["email.gemini_field_accuracy"] = await emailAccuracy(async (e) => (await extractEmail(gemini, { ...e, attachments: [] })).data, "email gemini");

// Regulation copilot, against the seeded demo database.
async function copilot(mode: "rules" | "gemini") {
  const db = await createPgliteDb();
  await seedDemo(db);
  let hits = 0, supported = 0, valid = 0, routed = 0, unsupported = 0;
  for (const q of COPILOT_QUESTIONS) {
    const r = await askQuestion({ db, gemini: mode === "gemini" ? gemini : null }, { orgId: DEMO_ORG_ID, question: q.question, channel: "portal", asker: "eval", shipmentId: "shp_hamburg" });
    if (q.unsupported) {
      unsupported++;
      if (r.status === "needs_person") routed++;
      else notes.push(`copilot ${mode} answered an unsupported question: ${q.question}`);
      continue;
    }
    supported++;
    if (r.citations.some((c) => c.id === q.cite)) hits++;
    else notes.push(`copilot ${mode} missed ${q.cite} for: ${q.question} (cited ${r.citations.map((c) => c.id).join(", ") || "nothing"})`);
    if (r.status !== "needs_person" && checkCitations(r.answer, r.citations.map((c) => c.id)).ok) valid++;
  }
  return { hit: hits / supported, valid: valid / supported, routed: routed / unsupported };
}
{
  const r = await copilot("rules");
  scores["copilot.citation_hit_rate"] = r.hit;
  scores["copilot.citations_valid"] = r.valid;
  scores["copilot.unsupported_routed"] = r.routed;
  if (gemini) {
    const g = await copilot("gemini");
    scores["copilot.gemini_citations_valid"] = g.valid;
    notes.push(`copilot gemini: hit rate ${g.hit.toFixed(2)}, routed ${g.routed.toFixed(2)}`);
  }
}

// Shipment planner: constraints always met, and exact against brute force.
{
  const rand = mulberry32(2026);
  let met = 0, optimal = 0;
  const N = 150;
  for (let n = 0; n < N; n++) {
    const ships: PlanShipment[] = Array.from({ length: 2 + Math.floor(rand() * 2) }, (_, i) => ({ id: `S${i}`, ref: `S${i}`, volumeKg: 19_200, gradeRequired: rand() < 0.5 ? "G1" : "G2" }));
    const lots: PlanLot[] = Array.from({ length: 6 }, (_, i) => ({
      id: `L${i}`,
      ref: `L${i}`,
      grade: rand() < 0.5 ? "G1" : "G2",
      kg: 9_600,
      valueUsd: 50_000 + Math.round(rand() * 10_000),
      currentShipmentId: rand() < 0.6 ? ships[Math.floor(rand() * ships.length)].id : null,
      pReady: Object.fromEntries(ships.map((s) => [s.id, Math.round(rand() * 100) / 100])),
    }));
    const plan = planContainers({ shipments: ships, lots });
    const ok = ships.every((s) => {
      const chosen = lots.filter((l) => plan.allocation[s.id].includes(l.id));
      return chosen.every((l) => qualifies(l, s)) && (!plan.filled[s.id] || chosen.reduce((t, l) => t + l.kg, 0) >= s.volumeKg);
    });
    if (ok) met++;
    if (Math.abs(plan.expectedOnTime - bruteForce(ships, lots)) < 0.002) optimal++;
  }
  scores["planner.constraints_met"] = met / N;
  scores["planner.optimal_rate"] = optimal / N;
}

// Route solver against brute force.
{
  const rand = mulberry32(11);
  let optimal = 0, gap = 0;
  const N = 100;
  for (let n = 0; n < N; n++) {
    const pts: LonLat[] = Array.from({ length: 8 }, (): LonLat => [38.18 + rand() * 0.08, 6.05 + rand() * 0.08]);
    const m = estimateMatrix(pts);
    const got = tourMinutes(solveTour(m), m);
    const best = bestTour(m);
    if (got === best) optimal++;
    gap += best ? (got - best) / best : 0;
  }
  scores["routes.optimal_rate"] = optimal / N;
  scores["routes.mean_gap"] = gap / N;
}

// Field liaison (Gemini only).
if (gemini) {
  let right = 0;
  for (const r of REPLIES) {
    const out = await extractReply({ updateId: 1, chatId: 1, fromId: 1, kind: "text", text: r.text }, r.open, gemini);
    if (out.intent === r.intent && JSON.stringify(out.plotRefs.sort()) === JSON.stringify(r.refs.sort())) right++;
    else notes.push(`field liaison: "${r.text}" gave ${out.intent} ${out.plotRefs.join(",")}`);
  }
  scores["field_liaison.gemini_accuracy"] = right / REPLIES.length;
}

// Gate.
const thresholds = JSON.parse(readFileSync("evals/thresholds.json", "utf8")) as Record<string, number>;
let baseline: Record<string, number> = {};
try {
  baseline = JSON.parse(readFileSync("evals/baseline.json", "utf8"));
} catch {}
const lowerIsBetter = (k: string) => k.endsWith("gap");
const failures: string[] = [];
const lines = ["| Metric | Score | Threshold | Baseline | |", "|---|---|---|---|---|"];
for (const [k, v] of Object.entries(scores)) {
  const t = thresholds[k];
  const b = baseline[k];
  const belowThreshold = t !== undefined && (lowerIsBetter(k) ? v > t : v < t);
  const regressed = b !== undefined && (lowerIsBetter(k) ? v > b + 0.01 : v < b - 0.01);
  if (belowThreshold) failures.push(`${k} ${v.toFixed(3)} misses its threshold ${t}`);
  if (regressed) failures.push(`${k} ${v.toFixed(3)} dropped from the baseline ${b}`);
  lines.push(`| ${k} | ${v.toFixed(3)} | ${t ?? "-"} | ${b?.toFixed(3) ?? "-"} | ${belowThreshold || regressed ? "FAIL" : "ok"} |`);
}
if (!gemini) lines.push("", "Gemini sets skipped: GEMINI_API_KEY is not set.");
const report = [`# Kaffa evaluation report`, "", ...lines, "", ...(notes.length ? ["## Notes", "", ...notes.map((n) => `- ${n}`)] : [])].join("\n");
mkdirSync("evals/out", { recursive: true });
writeFileSync("evals/out/report.md", report);
console.log(report);
if (process.argv.includes("--baseline")) {
  const deterministic = Object.fromEntries(Object.entries(scores).filter(([k]) => !k.includes("gemini")));
  writeFileSync("evals/baseline.json", `${JSON.stringify(deterministic, null, 2)}\n`);
  console.log("\nBaseline written.");
}
if (failures.length) {
  console.error(`\n${failures.length} gate failure(s):\n${failures.join("\n")}`);
  process.exit(1);
}
process.exit(0);

function bruteForce(ships: PlanShipment[], lots: PlanLot[]): number {
  let best = 0;
  const opts = [...ships.map((s) => s.id), null];
  const total = opts.length ** lots.length;
  for (let code = 0; code < total; code++) {
    let c = code;
    const kg: Record<string, number> = Object.fromEntries(ships.map((s) => [s.id, 0]));
    const p: Record<string, number> = Object.fromEntries(ships.map((s) => [s.id, 1]));
    let ok = true;
    for (const l of lots) {
      const choice = opts[c % opts.length];
      c = Math.floor(c / opts.length);
      if (!choice) continue;
      if (!qualifies(l, ships.find((s) => s.id === choice)!)) ok = false;
      kg[choice] += l.kg;
      p[choice] *= l.pReady[choice];
    }
    if (!ok) continue;
    best = Math.max(best, ships.reduce((t, s) => t + (kg[s.id] >= s.volumeKg && kg[s.id] <= s.volumeKg + 1_200 ? p[s.id] : 0), 0));
  }
  return best;
}

function bestTour(m: number[][]): number {
  let best = Infinity;
  const go = (rest: number[], path: number[], cost: number) => {
    if (cost >= best) return;
    if (!rest.length) {
      best = Math.min(best, cost + m[path.at(-1)!][0]);
      return;
    }
    rest.forEach((n, i) => go([...rest.slice(0, i), ...rest.slice(i + 1)], [...path, n], cost + m[path.at(-1)!][n]));
  };
  go(m.map((_, i) => i).slice(1), [0], 0);
  return best;
}
