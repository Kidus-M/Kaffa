import { verifyWebhookSecret } from "@/integrations/telegram";
import { env } from "@/config/env";
import { inngest } from "@/workflows/client";
import { EVENTS } from "@/workflows/events";

/** Called once a day by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
  if (!secret || !verifyWebhookSecret(token, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  await inngest.send({ name: EVENTS.dailyRequested, data: { trigger: "cron" } });
  return Response.json({ ok: true });
}
