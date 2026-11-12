import { verifyWebhookSecret } from "@/integrations/telegram";
import { env } from "@/config/env";
import { runDailyInline } from "@/services/daily";
import { getAppDeps } from "@/services/deps";
import { inngest } from "@/workflows/client";
import { EVENTS } from "@/workflows/events";

/** The inline run screens every plot against the satellite API; give it the full function limit. */
export const maxDuration = 300;

/**
 * Called once a day by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`.
 * With Inngest configured, the durable daily workflow does the work; without it, the
 * same work runs here.
 */
export async function GET(request: Request) {
  const e = env();
  const secret = e.CRON_SECRET;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
  if (!secret || !verifyWebhookSecret(token, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (e.INNGEST_EVENT_KEY || process.env.INNGEST_DEV) {
    try {
      await inngest.send({ name: EVENTS.dailyRequested, data: { trigger: "cron" } });
      return Response.json({ ok: true, mode: "durable" });
    } catch {
      // Inngest unreachable: fall through and do the work now.
    }
  }
  const summary = await runDailyInline(await getAppDeps());
  return Response.json({ ok: true, mode: "inline", summary });
}
