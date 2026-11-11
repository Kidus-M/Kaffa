import { env } from "@/config/env";
import { getAppDeps } from "@/services/deps";
import { handleInbound } from "@/services/field-inbound";
import { handleTelegramWebhook } from "@/services/webhook";

export async function POST(request: Request) {
  return handleTelegramWebhook(request, {
    secret: env().TELEGRAM_WEBHOOK_SECRET,
    handle: async (msg) => handleInbound(msg, await getAppDeps()),
  });
}
