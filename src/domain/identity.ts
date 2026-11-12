/**
 * Identity resolution across scripts. The same farmer can appear as ተስፋዬ ግርማ in one
 * register and as Tesfaye or Tesfaie Girma in another. Names are transliterated from
 * Ge'ez script, normalised for common spelling variants, and compared by spelling and
 * by consonant skeleton; village, cooperative and phone number adjust the score.
 * Every score comes with the reasons behind it.
 */
import { MERGE_PROPOSE_SCORE } from "@/config/policy";

/** Latin consonant for each row of the Ethiopic syllabary (U+1200 + 8 x row). */
const ROWS = [
  "h", "l", "h", "m", "s", "r", "s", "sh", "k", "kw", "k", "kw", "b", "v", "t", "ch", "h", "hw", "n", "ny",
  "", "k", "kw", "h", "hw", "w", "", "z", "zh", "y", "d", "d", "j", "g", "gw", "g", "t", "ch", "p", "ts", "ts", "f", "p",
];
/** Vowel for each of the eight orders; the sixth order often carries no vowel. */
const ORDERS = ["e", "u", "i", "a", "e", "", "o", "wa"];
/** Glottal rows (አ, ዐ) are written with their vowel alone; the first order reads "a" in names (አበበ, Abebe). */
const GLOTTAL_ORDERS = ["a", "u", "i", "a", "e", "e", "o", "wa"];
const GLOTTAL_ROWS = new Set([20, 26]);

const GEEZ = /[ሀ-፿]/;

export function hasGeez(text: string): boolean {
  return GEEZ.test(text);
}

/** Ge'ez script to a plain Latin reading, e.g. ተስፋዬ ግርማ to "tesfaye grma". */
export function transliterate(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0x1361 || c === 0x1362) {
      out += " ";
      continue;
    }
    if (c < 0x1200 || c > 0x1357) {
      out += ch;
      continue;
    }
    const row = (c - 0x1200) >> 3;
    const order = (c - 0x1200) & 7;
    out += GLOTTAL_ROWS.has(row) ? GLOTTAL_ORDERS[order] : (ROWS[row] ?? "") + ORDERS[order];
  }
  return out.toLowerCase();
}

/** One name token in a canonical spelling: Tesfaie, Tesfaye and ተስፋዬ all become "tesfaie". */
export function normaliseToken(token: string): string {
  let t = token
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z]/g, "");
  t = t
    .replace(/ph/g, "f")
    .replace(/q/g, "k")
    .replace(/kh/g, "h")
    .replace(/c(?!h)/g, "ch")
    .replace(/y/g, "i")
    .replace(/(.)\1+/g, "$1");
  return t;
}

/** Consonant skeleton: the first letter, then consonants only. Absorbs vowels Ge'ez leaves unwritten. */
export function skeleton(token: string): string {
  const n = normaliseToken(token);
  return (n.slice(0, 1) + n.slice(1).replace(/[aeiou]/g, "")).replace(/(.)\1+/g, "$1");
}

export function nameTokens(name: string): string[] {
  const latin = hasGeez(name) ? transliterate(name) : name;
  return latin
    .split(/[\s,./-]+/)
    .map(normaliseToken)
    .filter(Boolean);
}

/** Jaro-Winkler similarity, 0 to 1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = bHit[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function tokenSimilarity(a: string, b: string): number {
  return 0.6 * jaroWinkler(a, b) + 0.4 * jaroWinkler(skeleton(a), skeleton(b));
}

/**
 * Both names must match: siblings share a father's name and namesakes share a given name,
 * so one strong token cannot carry a weak one. Below this, the weaker token sets the score.
 */
const TOKEN_FLOOR = 0.85;
const both = (s1: number, s2: number) => (Math.min(s1, s2) >= TOKEN_FLOOR ? (s1 + s2) / 2 : Math.min(s1, s2) * 0.9);

/** Compares given name and father's name, allowing for the two being written in swapped order. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.length === 1 || tb.length === 1) return tokenSimilarity(ta[0], tb[0]) * 0.85;
  const inOrder = both(tokenSimilarity(ta[0], tb[0]), tokenSimilarity(ta[1], tb[1]));
  const swapped = both(tokenSimilarity(ta[0], tb[1]), tokenSimilarity(ta[1], tb[0])) * 0.95;
  return Math.max(inOrder, swapped);
}

/** Ethiopian numbers in any format, as their last nine digits. */
export function normalisePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

export type Person = {
  id: string;
  /** Names the person is known by: the record's name, its Latin form, and any aliases. */
  names: string[];
  village?: string | null;
  phone?: string | null;
  cooperativeId?: string | null;
};

export type Match = { id: string; score: number; reasons: string[]; matchedName: string };

/** How likely two records are the same farmer, with the reasons for the score. */
export function scorePair(a: Person, b: Person): Omit<Match, "id"> {
  let best = { score: 0, a: a.names[0] ?? "", b: b.names[0] ?? "" };
  for (const na of a.names.filter(Boolean))
    for (const nb of b.names.filter(Boolean)) {
      const s = nameSimilarity(na, nb);
      if (s > best.score) best = { score: s, a: na, b: nb };
    }
  const reasons: string[] = [];
  const name = best.score;
  const crossScript = hasGeez(best.a) !== hasGeez(best.b);
  if (name >= 0.97) reasons.push(crossScript ? `Same name across scripts: ${best.a} reads as ${best.b}` : `Same name: ${best.b}`);
  else if (name >= 0.85) reasons.push(`Similar spelling: ${best.a} and ${best.b}`);
  else reasons.push(`Names differ: ${best.a} and ${best.b}`);

  let village = 0.5;
  if (a.village && b.village) {
    const same = jaroWinkler(normaliseToken(a.village), normaliseToken(b.village)) >= 0.9;
    village = same ? 1 : 0;
    reasons.push(same ? `Same village: ${b.village}` : `Different villages: ${a.village} and ${b.village}`);
  }
  let coop = 0.5;
  if (a.cooperativeId && b.cooperativeId) {
    coop = a.cooperativeId === b.cooperativeId ? 1 : 0;
    reasons.push(coop ? "Same cooperative" : "Different cooperatives");
  }
  let score = name * 0.75 + village * 0.15 + coop * 0.1;

  const pa = normalisePhone(a.phone);
  const pb = normalisePhone(b.phone);
  if (pa && pb) {
    if (pa === pb) {
      score += 0.12;
      reasons.push("Same phone number");
    } else {
      // Two different numbers on record is strong evidence of two people.
      score -= 0.2;
      reasons.push("Different phone numbers");
    }
  }
  return { score: Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000, reasons, matchedName: best.b };
}

/** Existing records that may be the same farmer as `candidate`, best first. */
export function findMatches(candidate: Person, existing: Person[], threshold = MERGE_PROPOSE_SCORE): Match[] {
  return existing
    .filter((e) => e.id !== candidate.id)
    .map((e) => ({ id: e.id, ...scorePair(candidate, e) }))
    .filter((m) => m.score >= threshold)
    .sort((x, y) => y.score - x.score);
}

/** Every likely duplicate pair within one set of records, best first. */
export function findDuplicatePairs(people: Person[], threshold = MERGE_PROPOSE_SCORE): { a: string; b: string; score: number; reasons: string[] }[] {
  const out: { a: string; b: string; score: number; reasons: string[] }[] = [];
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) {
      const s = scorePair(people[i], people[j]);
      if (s.score >= threshold) out.push({ a: people[i].id, b: people[j].id, score: s.score, reasons: s.reasons });
    }
  return out.sort((x, y) => y.score - x.score);
}
