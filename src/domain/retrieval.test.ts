import { describe, expect, it } from "vitest";
import { PASSAGES } from "@/knowledge/eudr";
import { bm25, checkCitations, citedIds, cosine, fuse, tokenize } from "./retrieval";

describe("tokenize", () => {
  it("drops stop words and stems plurals", () => {
    expect(tokenize("What are the plots of land?")).toEqual(["plot", "land"]);
  });
});

describe("bm25 over the regulation", () => {
  const docs = PASSAGES.map((p) => ({ id: p.id, text: `${p.title}. ${p.text}` }));
  it.each([
    ["How long must we keep due diligence records?", "art12"],
    ["Do plots above four hectares need a polygon?", "art2-geolocation"],
    ["What is the cut-off date for deforestation?", "art2-deforestation-free"],
    ["When does the regulation apply to small companies?", "art38"],
    ["What are the fines for breaking the rules?", "art25"],
    ["Can a polygon have holes?", "geojson-holes"],
  ])("finds the passage for %s", (q, id) => {
    expect(bm25(docs, q).slice(0, 3).map((r) => r.id)).toContain(id);
  });

  it("scores an unrelated question near zero", () => {
    expect(bm25(docs, "What is the best espresso grinder?")[0].score).toBeLessThan(2.5);
  });
});

describe("fusion and similarity", () => {
  it("fuses rankings so items high in both win", () => {
    expect(fuse([[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }, { id: "c" }]])[2].id).toBe("c");
  });
  it("computes cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
});

describe("checkCitations", () => {
  it("accepts an answer where each claim cites a provided source", () => {
    const a = "Records must be kept for five years [art12]. Plots over four hectares need polygons [art2-geolocation].";
    expect(checkCitations(a, ["art12", "art2-geolocation"]).ok).toBe(true);
    expect(citedIds(a)).toEqual(["art12", "art2-geolocation"]);
  });

  it("rejects missing, invented and partial citations", () => {
    expect(checkCitations("Records are kept for five years.", ["art12"]).ok).toBe(false);
    expect(checkCitations("Records are kept for five years [art99].", ["art12"]).problems[0]).toMatch(/unknown/);
    expect(checkCitations("Records are kept for five years [art12]. Fines are capped at ten percent of turnover.", ["art12"]).ok).toBe(false);
  });
});
