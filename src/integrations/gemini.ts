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
}

export function createGemini(opts: { apiKey?: string; model: string }): GeminiLike | null {
  if (!opts.apiKey) return null;
  const apiKey = opts.apiKey;
  return {
    async generateJson<T>(req: GenerateJsonRequest<T>) {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      let response;
      try {
        response = await ai.models.generateContent({
          model: opts.model,
          contents: [{ role: "user", parts: req.parts }],
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(req.schema),
            temperature: 0.2,
          },
        });
      } catch (e) {
        throw new GeminiUnavailable(e instanceof Error ? e.message : String(e));
      }
      const parsed = req.schema.safeParse(JSON.parse(response.text ?? "null"));
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
