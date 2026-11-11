/**
 * Deterministic synthetic demo data. Every record is marked synthetic. Plots sit at
 * real coffee-growing locations so satellite checks return real results, but the
 * farmers, cooperatives and buyers are invented.
 */
import { mulberry32 } from "@/domain/random";
import type { PlotGeometry, Position } from "@/domain/types";

export const DEMO_ORG_ID = "org_demo";

type Coop = { id: string; name: string; region: string; prefix: string; center: [number, number] };

export const COOPS: Coop[] = [
  { id: "coop_konga", name: "Konga Farmers Cooperative (synthetic)", region: "Yirgacheffe, Gedeo", prefix: "KNG", center: [38.215, 6.095] },
  { id: "coop_hambela", name: "Hambela Farmers Cooperative (synthetic)", region: "Hambela Wamena, Guji", prefix: "HMB", center: [38.745, 5.87] },
];

export const FIELD_AGENTS = [
  { id: "fa_tigist", cooperativeId: "coop_konga", name: "Tigist Alemu (synthetic)", token: "fa-tigist-7d1c" },
  { id: "fa_dawit", cooperativeId: "coop_konga", name: "Dawit Bekele (synthetic)", token: "fa-dawit-3b9e" },
  { id: "fa_chaltu", cooperativeId: "coop_hambela", name: "Chaltu Gemechu (synthetic)", token: "fa-chaltu-5a2f" },
];

/** Past gap resolution times in days, which drive the on-time forecast. */
export const RESOLUTION_HISTORY_DAYS: Record<string, number[]> = {
  fa_tigist: [1, 1, 2, 2, 3],
  fa_dawit: [3, 4, 6, 8],
  fa_chaltu: [],
};

const NAMES: [string, string][] = [
  ["Abebe Kebede", "አበበ ከበደ"], ["Almaz Tadesse", "አልማዝ ታደሰ"], ["Bekele Hailu", "በቀለ ኃይሉ"], ["Dawit Tesfaye", "ዳዊት ተስፋዬ"],
  ["Genet Wolde", "ገነት ወልዴ"], ["Hailu Mekonnen", "ኃይሉ መኮንን"], ["Kebede Alemu", "ከበደ አለሙ"], ["Tesfaye Girma", "ተስፋዬ ግርማ"],
  ["Tadesse Bekele", "ታደሰ በቀለ"], ["Mulu Desta", "ሙሉ ደስታ"], ["Obsa Gutu", ""], ["Chaltu Dida", ""], ["Lemlem Haile", "ለምለም ኃይሌ"],
  ["Yohannes Abera", "ዮሐንስ አበራ"], ["Senait Kahsay", "ሰናይት ካሕሳይ"], ["Fikru Ayele", "ፍቅሩ አየለ"], ["Wubit Demisse", "ውብት ደምሴ"],
  ["Netsanet Assefa", "ነፃነት አሰፋ"], ["Gutu Waqo", ""], ["Boru Jilo", ""],
];

export type SeedPlot = {
  ref: string;
  cooperativeId: string;
  farmerIndex: number;
  geometry: PlotGeometry | null;
  declaredAreaHa: number;
  note?: string;
};

const mPerDegLat = 111_320;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** An irregular quadrilateral of roughly `ha` hectares around a centre point. */
function farmShape(rand: () => number, [lon, lat]: [number, number], ha: number): Position[] {
  const side = Math.sqrt(ha * 10_000);
  const j = () => (rand() - 0.5) * side * 0.25;
  const corners: [number, number][] = [
    [-side / 2 + j(), -side / 2 + j()],
    [side / 2 + j(), -side / 2 + j()],
    [side / 2 + j(), side / 2 + j()],
    [-side / 2 + j(), side / 2 + j()],
  ];
  const ring = corners.map(([dx, dy]): Position => [r6(lon + dx / mPerDegLon(lat)), r6(lat + dy / mPerDegLat)]);
  return [...ring, ring[0]];
}

export function buildSeedPlots(seed = 2026): SeedPlot[] {
  const rand = mulberry32(seed);
  const out: SeedPlot[] = [];
  for (const coop of COOPS) {
    for (let i = 1; i <= 20; i++) {
      const ref = `${coop.prefix}-${String(i).padStart(3, "0")}`;
      const centre: [number, number] = [
        coop.center[0] + ((rand() - 0.5) * 4000) / mPerDegLon(coop.center[1]),
        coop.center[1] + ((rand() - 0.5) * 4000) / mPerDegLat,
      ];
      const ha = Math.round((0.4 + rand() * 2.1) * 100) / 100;
      const asPoint = i % 6 === 0;
      out.push({
        ref,
        cooperativeId: coop.id,
        farmerIndex: (i - 1) % NAMES.length,
        declaredAreaHa: ha,
        geometry: asPoint
          ? { type: "Point", coordinates: [r6(centre[0]), r6(centre[1])] }
          : { type: "Polygon", coordinates: [farmShape(rand, centre, ha)] },
      });
    }
  }

  const byRef = (ref: string) => out.find((p) => p.ref === ref)!;
  const centreOf = (p: SeedPlot): [number, number] => {
    const g = p.geometry!;
    if (g.type === "Point") return [g.coordinates[0], g.coordinates[1]];
    const ring = (g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0]).slice(0, -1);
    return [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length];
  };

  // Deliberate problems, one per rule, so the demo shows every check working.
  const swapped = byRef("KNG-007");
  const [sx, sy] = centreOf(swapped);
  swapped.geometry = { type: "Point", coordinates: [r6(sy), r6(sx)] };
  swapped.declaredAreaHa = 1.2;
  swapped.note = "Latitude and longitude swapped in the register";

  const bigPoint = byRef("KNG-011");
  bigPoint.geometry = { type: "Point", coordinates: centreOf(bigPoint).map(r6) };
  bigPoint.declaredAreaHa = 6.2;
  bigPoint.note = "Above 4 ha but recorded as a single point";

  const bowtie = byRef("KNG-015");
  const ring = farmShape(rand, centreOf(bowtie), 1.5);
  bowtie.geometry = { type: "Polygon", coordinates: [[ring[0], ring[2], ring[1], ring[3], ring[0]]] };
  bowtie.declaredAreaHa = 1.5;
  bowtie.note = "Corners recorded in the wrong order, so the boundary crosses itself";

  const a = byRef("HMB-004");
  const b = byRef("HMB-005");
  const [ax, ay] = centreOf(a);
  a.geometry = { type: "Polygon", coordinates: [farmShape(rand, [ax, ay], 1.4)] };
  b.geometry = { type: "Polygon", coordinates: [farmShape(rand, [ax + 60 / mPerDegLon(ay), ay], 1.4)] };
  a.declaredAreaHa = b.declaredAreaHa = 1.4;
  b.note = "Overlaps HMB-004: two farmers claim the same land";

  const open = byRef("HMB-012");
  if (open.geometry?.type === "Polygon") open.geometry = { type: "Polygon", coordinates: [open.geometry.coordinates[0].slice(0, -1)] };
  open.note = "Boundary not closed; repaired automatically";

  return out;
}

export function farmerName(index: number): { name: string; nameLatin: string } {
  const [latin, amharic] = NAMES[index % NAMES.length];
  return { name: amharic || latin, nameLatin: latin };
}

export const SHIPMENTS = [
  {
    id: "shp_hamburg",
    ref: "HAM-2612",
    buyerName: "Elbe Roasters (synthetic)",
    destinationPort: "Hamburg",
    shipDate: "2026-12-08",
    contractVolumeKg: 19_200,
    portalToken: "portal-elbe-4f8a2c",
    lots: ["KNG-L1", "HMB-L3"],
  },
  {
    id: "shp_antwerp",
    ref: "ANR-2612",
    buyerName: "Scheldt Coffee Traders (synthetic)",
    destinationPort: "Antwerp",
    shipDate: "2026-12-18",
    contractVolumeKg: 19_200,
    portalToken: "portal-scheldt-9b1d7e",
    lots: ["KNG-L2", "HMB-L4"],
  },
];

/** Lot ref → plot refs. Each lot is 160 bags of 60 kg. */
export const LOTS: { ref: string; grade: string; plotRefs: (prefix: string) => string[]; prefix: string }[] = [
  { ref: "KNG-L1", grade: "Yirgacheffe washed G1", prefix: "KNG", plotRefs: (p) => range(1, 10, p) },
  { ref: "KNG-L2", grade: "Yirgacheffe natural G1", prefix: "KNG", plotRefs: (p) => range(11, 20, p) },
  { ref: "HMB-L3", grade: "Guji natural G1", prefix: "HMB", plotRefs: (p) => range(1, 10, p) },
  { ref: "HMB-L4", grade: "Guji washed G2", prefix: "HMB", plotRefs: (p) => range(11, 20, p) },
];

function range(from: number, to: number, prefix: string): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${String(from + i).padStart(3, "0")}`);
}
