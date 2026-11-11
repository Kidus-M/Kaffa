import { z } from "zod";

/** Optional string: empty strings count as unset so `.env` placeholders don't enable an integration. */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

const schema = z.object({
  DATABASE_URL: optional,
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GFW_API_KEY: optional,
  GFW_ORIGIN: optional,
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_WEBHOOK_SECRET: optional,
  TELEGRAM_BOT_USERNAME: optional,
  INNGEST_EVENT_KEY: optional,
  INNGEST_SIGNING_KEY: optional,
  CRON_SECRET: optional,
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
