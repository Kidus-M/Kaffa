/**
 * Copies Kaffa's keys from .env.local into the linked Vercel project's production
 * environment. Run it yourself; it prints key names only, never values.
 *
 *   node scripts/push-env.mjs https://your-app.vercel.app
 *
 * The argument becomes APP_URL in production. DATABASE_URL is not copied: the Neon
 * integration already manages it. Local-only settings (INNGEST_DEV, the Vercel token) are
 * skipped, and empty keys are left alone.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const appUrl = process.argv[2];
if (!appUrl?.startsWith("https://")) {
  console.error("Pass the production URL, for example: node scripts/push-env.mjs https://kaffa.vercel.app");
  process.exit(1);
}

const KEYS = [
  "GEMINI_API_KEY", "GEMINI_MODEL", "GFW_API_KEY", "GFW_ORIGIN",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_USERNAME",
  "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY", "CRON_SECRET", "ORS_API_KEY",
  "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_QUERY",
  "BREVO_API_KEY", "BREVO_SENDER",
];

const local = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) local[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
local.APP_URL = appUrl.replace(/\/$/, "");

const vercel = process.platform === "win32" ? "vercel.cmd" : "vercel";
for (const key of [...KEYS, "APP_URL"]) {
  const value = local[key];
  if (!value) continue;
  execFileSync(vercel, ["env", "add", key, "production", "--force"], { input: value, stdio: ["pipe", "ignore", "inherit"], shell: process.platform === "win32" });
  console.log(`set ${key}`);
}
console.log("Done. Redeploy for the new values to take effect: vercel deploy --prod");
