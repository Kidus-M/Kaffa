import { z } from "zod";

/** Optional string: empty strings count as unset so `.env` placeholders don't enable an integration. */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

const schema = z.object({
  DATABASE_URL: optional,
  GEMINI_API_KEY: optional,
  /** One model, or several separated by commas: later ones are fallbacks when one is overloaded or retired. */
  GEMINI_MODEL: z.string().default("gemini-3.5-flash,gemini-3.5-flash-lite"),
  GFW_API_KEY: optional,
  GFW_ORIGIN: optional,
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_WEBHOOK_SECRET: optional,
  TELEGRAM_BOT_USERNAME: optional,
  INNGEST_EVENT_KEY: optional,
  INNGEST_SIGNING_KEY: optional,
  CRON_SECRET: optional,
  ORS_API_KEY: optional,
  GMAIL_CLIENT_ID: optional,
  GMAIL_CLIENT_SECRET: optional,
  GMAIL_REFRESH_TOKEN: optional,
  GMAIL_QUERY: z.string().default("label:kaffa newer_than:30d"),
  BREVO_API_KEY: optional,
  BREVO_SENDER: optional,
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  APP_URL: z.url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source);
}

let cached: Env | undefined;

/** Lazily parsed so tests and scripts can set process.env first. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
