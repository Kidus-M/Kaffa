/**
 * Retrieval for cited answers. BM25 over passages always works offline; when embeddings
 * exist, vector similarity is fused with BM25 by reciprocal rank fusion.
 */

const STOP = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its my non of on or our so that the their them then there these this to was we what when where which who why will with you your".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map(stem);
}

/** A light English stemmer: enough to match "plots" with "plot" and "mapped" with "map". */
function stem(t: string): string {
  if (t.length <= 4 || /^\d/.test(t)) return t;
  return t.replace(/(ations?|ings?|ies|ied|ed|es|s)$/, (m) => (m === "ies" || m === "ied" ? "y" : ""));
}

export type Doc = { id: string; text: string };

export function bm25(docs: Doc[], query: string, k1 = 1.4, b = 0.75): { id: string; score: number }[] {
  const q = [...new Set(tokenize(query))];
  const toks = docs.map((d) => tokenize(d.text));
  const avg = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, toks.length);
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  return docs
    .map((d, i) => {
      const tf = new Map<string, number>();
      for (const w of toks[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w) ?? 0;
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks[i].length) / avg));
      }
      return { id: d.id, score: Math.round(score * 1000) / 1000 };
    })
    .sort((x, y) => y.score - x.score);
}

/** Share of the question's distinct terms that appear in a passage; one generic word is not support. */
export function coverage(text: string, query: string): number {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return 0;
  const doc = new Set(tokenize(text));
  return q.filter((t) => doc.has(t)).length / q.length;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Reciprocal rank fusion of several rankings. */
export function fuse(rankings: { id: string }[][], k = 60): { id: string; score: number }[] {
  const s = new Map<string, number>();
  for (const r of rankings) r.forEach((item, rank) => s.set(item.id, (s.get(item.id) ?? 0) + 1 / (k + rank + 1)));
  return [...s.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/** Citation markers like [art9] or [E3] in an answer. */
export function citedIds(answer: string): string[] {
  return [...new Set([...answer.matchAll(/\[([A-Za-z0-9-]+)\]/g)].map((m) => m[1]))];
}

/**
 * An answer is acceptable only if it cites at least one source, cites nothing that was not
 * provided, and every sentence with a claim carries a citation.
 */
export function checkCitations(answer: string, allowed: string[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const ids = citedIds(answer);
  if (!ids.length) problems.push("no citation");
  const unknown = ids.filter((id) => !allowed.includes(id));
  if (unknown.length) problems.push(`unknown sources: ${unknown.join(", ")}`);
  const sentences = answer
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
  const bare = sentences.filter((s) => !/\[[A-Za-z0-9-]+\]/.test(s));
  if (bare.length) problems.push(`${bare.length} sentence(s) without a citation`);
  return { ok: problems.length === 0, problems };
}
