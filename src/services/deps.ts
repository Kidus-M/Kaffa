/**
 * Builds the live dependencies from the environment. Every integration degrades:
 * no key means simulated data or templates, and the console labels it.
 */
import { env } from "@/config/env";
import { getDb } from "@/db/client";
import { createGemini } from "@/integrations/gemini";
import { createGfwClient } from "@/integrations/gfw";
import { createTelegramClient } from "@/integrations/telegram";
import { inngest } from "@/workflows/client";
import { EVENTS, type Emit } from "@/workflows/events";
import { screenPlot } from "./screening";

export async function getAppDeps() {
  const e = env();
  const db = await getDb();
  const gfw = createGfwClient({ apiKey: e.GFW_API_KEY, origin: e.GFW_ORIGIN });
  const gemini = createGemini({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL });
  const telegram = e.TELEGRAM_BOT_TOKEN ? createTelegramClient(e.TELEGRAM_BOT_TOKEN) : null;

  /**
   * Sends to Inngest. If Inngest is unreachable (no dev server, no key), screening runs
   * inline so the demo still works; waiting workflows simply don't start.
   */
  const emit: Emit = async (event) => {
    try {
      await inngest.send(event);
    } catch {
      if (event.name === EVENTS.plotScreenRequested) {
        await screenPlot({ db, gfw }, event.data as { orgId: string; plotId: string });
      }
    }
  };

  return { db, gfw, gemini, telegram, emit, appUrl: e.APP_URL, integrations: integrationStatus() };
}

/** What is live and what is simulated, for the console's status strip. */
export function integrationStatus() {
  const e = env();
  return {
    database: e.DATABASE_URL ? "neon" : "local",
    satellite: e.GFW_API_KEY ? "live" : "simulated",
    gemini: e.GEMINI_API_KEY ? "live" : "templates",
    telegram: e.TELEGRAM_BOT_TOKEN ? "live" : "off",
    workflows: e.INNGEST_EVENT_KEY || process.env.INNGEST_DEV ? "durable" : "inline",
  } as const;
}
