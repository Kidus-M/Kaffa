import { describe, expect, it } from "vitest";
import { findDuplicatePairs, findMatches, nameSimilarity, normalisePhone, normaliseToken, scorePair, skeleton, transliterate } from "./identity";

describe("transliterate", () => {
  it.each([
    ["ተስፋዬ", "tesfaye"],
    ["አበበ", "abebe"],
    ["ከበደ", "kebede"],
    ["በቀለ", "bekele"],
    ["አልማዝ", "almaz"],
    ["ኃይሉ", "haylu"],
    ["ግርማ", "grma"],
  ])("reads %s as %s", (geez, latin) => {
    expect(transliterate(geez)).toBe(latin);
  });

  it("keeps Latin text and turns the Ethiopic word space into a space", () => {
    expect(transliterate("ተስፋዬ፡ግርማ")).toBe("tesfaye grma");
    expect(transliterate("Abebe")).toBe("abebe");
  });
});

describe("normalisation", () => {
  it("treats common spelling variants as one", () => {
    expect(normaliseToken("Tesfaye")).toBe(normaliseToken("Tesfaie"));
    expect(normaliseToken("Tadesse")).toBe(normaliseToken("Tadese"));
    expect(normaliseToken("Haylu")).toBe(normaliseToken("Hailu"));
  });

  it("matches the consonant skeleton when Ge'ez leaves vowels unwritten", () => {
    expect(skeleton(transliterate("ግርማ"))).toBe(skeleton("Girma"));
    expect(skeleton(transliterate("መኮንን"))).toBe(skeleton("Mekonnen"));
  });

  it("reduces phone numbers to their last nine digits", () => {
    expect(normalisePhone("+251 911 000 101")).toBe(normalisePhone("0911000101"));
    expect(normalisePhone("12345")).toBeNull();
  });
});

describe("nameSimilarity", () => {
  it("scores the same person across scripts and spellings highly", () => {
    expect(nameSimilarity("ተስፋዬ ግርማ", "Tesfaie Girma")).toBeGreaterThan(0.95);
    expect(nameSimilarity("ብርሃኑ ታደሰ", "Birhanu Tadesse")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Girma Tesfaye", "Tesfaye Girma")).toBeGreaterThan(0.9);
  });

  it("scores different people low", () => {
    expect(nameSimilarity("Abebe Kebede", "Almaz Tadesse")).toBeLessThan(0.7);
    expect(nameSimilarity("Mulu Desta", "Hana Desta")).toBeLessThan(0.85);
  });
});

describe("scorePair and findMatches", () => {
  const tesfaye = { id: "f1", names: ["ተስፋዬ ግርማ", "Tesfaye Girma"], village: "Konga", cooperativeId: "c1" };

  it("proposes a cross-script match in the same village, with reasons", () => {
    const m = scorePair({ id: "new", names: ["Tesfaie Girma"], village: "Konga", cooperativeId: "c1" }, tesfaye);
    expect(m.score).toBeGreaterThanOrEqual(0.95);
    expect(m.reasons).toContain("Same village: Konga");
  });

  it("does not match a namesake in another village and cooperative", () => {
    const m = scorePair({ id: "new", names: ["Tesfaye Girma"], village: "Wamena", cooperativeId: "c2" }, tesfaye);
    expect(m.score).toBeLessThan(0.82);
  });

  it("raises the score for a matching phone and lowers it for a different one", () => {
    const base = { id: "a", names: ["Tesfaie Girma"], village: null, cooperativeId: "c1" };
    const other = { ...tesfaye, village: null };
    const plain = scorePair(base, { ...other, phone: null }).score;
    expect(scorePair({ ...base, phone: "0911000101" }, { ...other, phone: "+251911000101" }).score).toBeGreaterThan(plain);
    expect(scorePair({ ...base, phone: "0911000101" }, { ...other, phone: "0911999999" }).score).toBeLessThan(plain);
  });

  it("returns only matches above the threshold, best first", () => {
    const existing = [tesfaye, { id: "f2", names: ["Abebe Kebede"], village: "Konga", cooperativeId: "c1" }];
    const matches = findMatches({ id: "new", names: ["Tesfaie Girma"], village: "Konga", cooperativeId: "c1" }, existing);
    expect(matches.map((m) => m.id)).toEqual(["f1"]);
  });

  it("finds duplicate pairs within one set", () => {
    const pairs = findDuplicatePairs([
      tesfaye,
      { id: "f3", names: ["Tesfaie Girma"], village: "Konga", cooperativeId: "c1" },
      { id: "f4", names: ["Hana Desta"], village: "Konga", cooperativeId: "c1" },
    ]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a, pairs[0].b].sort()).toEqual(["f1", "f3"]);
  });
});
