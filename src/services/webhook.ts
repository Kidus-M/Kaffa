import { parseUpdate, verifyWebhookSecret, type Inbound } from "@/integrations/telegram";

/**
 * Verifies and parses a Telegram webhook call. Telegram retries non-2xx responses,
 * so anything we choose not to handle still gets a 200.
 */
export async function handleTelegramWebhook(
  req: Request,
  opts: { secret: string | undefined; handle: (msg: Inbound) => Promise<unknown> },
): Promise<Response> {
  if (!opts.secret) return Response.json({ error: "webhook secret not configured" }, { status: 503 });
  if (!verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"), opts.secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const msg = parseUpdate(body);
  if (msg) await opts.handle(msg);
  return Response.json({ ok: true });
}
