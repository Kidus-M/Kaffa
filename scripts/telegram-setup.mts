/**
 * Connects the Telegram bot to a deployment: registers the webhook (with its secret) and
 * puts the field Mini App on the bot's menu button. Reads TELEGRAM_BOT_TOKEN,
 * TELEGRAM_WEBHOOK_SECRET and APP_URL from the environment, for example:
 *
 *   node --env-file=.env.production.local --import tsx scripts/telegram-setup.mts
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.APP_URL?.replace(/\/$/, "");

if (!token || !secret || !appUrl) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL first.");
  process.exit(1);
}
if (!appUrl.startsWith("https://")) {
  console.error(`APP_URL must be a public https address; Telegram cannot reach ${appUrl}.`);
  process.exit(1);
}

async function call(method: string, body?: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

const me = (await call("getMe")) as { username: string };
await call("setWebhook", {
  url: `${appUrl}/api/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ["message"],
  drop_pending_updates: true,
});
await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Field tasks", web_app: { url: `${appUrl}/field` } } });
await call("setMyCommands", { commands: [{ command: "start", description: "Connect with your personal link" }] });
const info = (await call("getWebhookInfo")) as { url: string; pending_update_count: number; last_error_message?: string };

console.log(`Bot @${me.username} connected.`);
console.log(`Webhook: ${info.url}${info.last_error_message ? ` (last error: ${info.last_error_message})` : ""}`);
console.log(`Menu button opens ${appUrl}/field`);
console.log(`Set TELEGRAM_BOT_USERNAME=${me.username} in the deployment if it isn't already.`);
process.exit(0);
