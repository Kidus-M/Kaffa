import { describe, expect, it } from "vitest";
import { GeminiUnavailable, type GeminiLike } from "@/integrations/gemini";
import { extractEmail, readEmailByRules } from "./email";
import { SAMPLE_EMAILS } from "./sample-emails";

const [contract, question, injection] = SAMPLE_EMAILS;

describe("readEmailByRules", () => {
  it("reads a contract's reference, volume, grade, port and date", () => {
    expect(readEmailByRules(contract)).toMatchObject({
      kind: "contract",
      buyerName: "Rhein Kaffee Kontor (synthetic)",
      contract: { ref: "RHK-2701", volumeKg: 19_200, grade: "G1", destinationPort: "Rotterdam", shipDate: "2027-01-20" },
    });
  });

  it("converts bags and tonnes to kilograms", () => {
    expect(readEmailByRules({ from: "a <a@b>", subject: "contract", body: "Contract AB-123 for 320 bags G2" }).contract?.volumeKg).toBe(19_200);
    expect(readEmailByRules({ from: "a <a@b>", subject: "contract", body: "Contract AB-123 for 19.2 tonnes G2" }).contract?.volumeKg).toBe(19_200);
  });

  it("copies a buyer's questions", () => {
    const r = readEmailByRules(question);
    expect(r.kind).toBe("question");
    expect(r.question).toContain("deforestation after the 2020 cut-off");
    expect(r.question).toContain("how long do you keep");
  });

  it("treats injected instructions as nothing to act on", () => {
    expect(readEmailByRules(injection)).toMatchObject({ kind: "other", question: null, contract: null });
  });
});

describe("extractEmail", () => {
  it("falls back to rules when Gemini is unavailable", async () => {
    const down: GeminiLike = {
      generateJson: async () => {
        throw new GeminiUnavailable("quota");
      },
    };
    const r = await extractEmail(down, contract);
    expect(r.mode).toBe("rules");
    expect(r.data.kind).toBe("contract");
  });

  it("uses Gemini's structured output when available", async () => {
    const gemini: GeminiLike = {
      generateJson: async () => ({
        data: { kind: "question", buyerName: "Elbe", contract: null, question: "Are the plots clear?", confidence: 0.9 },
        usage: { inputTokens: 10, outputTokens: 5 },
      }) as never,
    };
    const r = await extractEmail(gemini, question);
    expect(r).toMatchObject({ mode: "gemini", data: { kind: "question" } });
  });
});
