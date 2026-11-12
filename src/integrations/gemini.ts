/**
 * Thin Gemini client: structured JSON output validated with Zod, with token usage
 * for the agent trace. Gemini never sets a compliance status; callers only use it
 * to read text and write messages.
 */
import { z } from "zod";

export class GeminiUnavailable extends Error {
  constructor(reason: string) {
    super(`Gemini unavailable: ${reason}`);
    this.name = "GeminiUnavailable";
  }
}

const TIMEOUT_MS = 30_000;

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export type GenerateJsonRequest<T> = {
  agent: string;
  system: string;
  parts: GeminiPart[];
  schema: z.ZodType<T>;
};

export type GenerateJsonResult<T> = { data: T; usage: { inputTokens: number; outputTokens: number } };

export interface GeminiLike {
  generateJson<T>(req: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>>;
  /** Text embeddings for retrieval; absent in fakes that don't need them. */
  embed?(texts: string[], task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<{ vectors: number[][]; model: string }>;
}

export function createGemini(opts: { apiKey?: string; model: string; embeddingModel?: string }): GeminiLike | null {
  if (!opts.apiKey) return null;
  const apiKey = opts.apiKey;
  const embeddingModel = opts.embeddingModel ?? "gemini-embedding-001";
  // GEMINI_MODEL may list fallbacks, "a,b": a model that is overloaded or retired is skipped.
  const models = opts.model.split(",").map((m) => m.trim()).filter(Boolean);
  const client = async () => {
    const { GoogleGenAI } = await import("@google/genai");
    // A stalled call must not hold a request or a workflow step; callers fall back to rules or templates.
    return new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS } });
  };
  return {
    async embed(texts, task) {
      const ai = await client();
      try {
        const res = await ai.models.embedContent({
          model: embeddingModel,
          contents: texts,
          config: { taskType: task, outputDimensionality: 768 },
        });
        const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
        if (vectors.length !== texts.length) throw new Error("embedding count mismatch");
        return { vectors, model: embeddingModel };
      } catch (e) {
        throw new GeminiUnavailable(e instanceof Error ? e.message : String(e));
      }
    },
    async generateJson<T>(req: GenerateJsonRequest<T>) {
      const ai = await client();
      let response;
      let lastError = "no model configured";
      for (const model of models) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: req.parts }],
            config: {
              systemInstruction: req.system,
              responseMimeType: "application/json",
              responseJsonSchema: z.toJSONSchema(req.schema),
              temperature: 0.2,
            },
          });
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (!response) throw new GeminiUnavailable(lastError);
      let raw: unknown;
      try {
        raw = JSON.parse(response.text ?? "null");
      } catch {
        throw new GeminiUnavailable(`unparseable output for ${req.agent}`);
      }
      const parsed = req.schema.safeParse(raw);
      if (!parsed.success) throw new GeminiUnavailable(`invalid output for ${req.agent}`);
      return {
        data: parsed.data,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}
