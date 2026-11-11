/**
 * Telegram Bot API: request verification, update parsing and sending.
 * Validation follows https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time check of the X-Telegram-Bot-Api-Secret-Token header. */
export function verifyWebhookSecret(header: string | null, expected: string): boolean {
  if (!header || !expected) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type InitDataResult =
  | { ok: true; userId: number; authDate: number }
  | { ok: false; reason: "bad_hash" | "expired" | "malformed" };

const ONE_DAY_SEC = 86_400;

/**
 * Verifies Mini App init data. The data-check-string is every field except `hash`,
 * sorted, joined by newlines. Clients that add the newer `signature` field are
 * accepted whether or not they include it in the HMAC; both forms need the bot token.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec?: number; now?: number } = {},
): InitDataResult {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(authDate)) return { ok: false, reason: "malformed" };

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const sign = (exclude: string[]) => {
    const dataCheck = [...params.keys()]
      .filter((k) => !exclude.includes(k))
      .sort()
      .map((k) => `${k}=${params.get(k)}`)
      .join("\n");
    return createHmac("sha256", secret).update(dataCheck).digest();
  };
  const expected = Buffer.from(hash, "hex");
  const matches = [sign(["hash"]), sign(["hash", "signature"])].some(
    (h) => h.length === expected.length && timingSafeEqual(h, expected),
  );
  if (!matches) return { ok: false, reason: "bad_hash" };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (now - authDate > (opts.maxAgeSec ?? ONE_DAY_SEC)) return { ok: false, reason: "expired" };

  try {
    const user = JSON.parse(params.get("user") ?? "{}") as { id?: number };
    if (typeof user.id !== "number") return { ok: false, reason: "malformed" };
    return { ok: true, userId: user.id, authDate };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export type Inbound = {
  updateId: number;
  chatId: number;
  fromId: number;
  kind: "start" | "text" | "location" | "photo" | "voice";
  text?: string;
  startPayload?: string;
  location?: { lat: number; lon: number };
  fileId?: string;
};

type TgMessage = {
  chat?: { id?: number };
  from?: { id?: number };
  text?: string;
  caption?: string;
  location?: { latitude: number; longitude: number };
  photo?: { file_id: string }[];
  voice?: { file_id: string };
};

/** Normalises a Telegram update into what the field liaison handles; null for anything else. */
export function parseUpdate(update: unknown): Inbound | null {
  if (!update || typeof update !== "object") return null;
  const u = update as { update_id?: number; message?: TgMessage };
  const m = u.message;
  if (typeof u.update_id !== "number" || !m || typeof m.chat?.id !== "number") return null;
  const base = { updateId: u.update_id, chatId: m.chat.id, fromId: m.from?.id ?? m.chat.id };

  if (m.location) return { ...base, kind: "location", location: { lat: m.location.latitude, lon: m.location.longitude } };
  if (m.photo?.length) return { ...base, kind: "photo", fileId: m.photo.at(-1)!.file_id, text: m.caption };
  if (m.voice) return { ...base, kind: "voice", fileId: m.voice.file_id };
  if (typeof m.text === "string") {
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(m.text);
    if (start) return { ...base, kind: "start", startPayload: start[1] };
    return { ...base, kind: "text", text: m.text };
  }
  return null;
}

export type TelegramSender = {
  sendMessage(chatId: number, text: string, opts?: { webAppUrl?: string; buttonText?: string }): Promise<void>;
};

export function createTelegramClient(token: string, f: typeof fetch = fetch): TelegramSender {
  const call = async (method: string, body: unknown) => {
    const res = await f(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Telegram ${method} failed with ${res.status}`);
  };
  return {
    async sendMessage(chatId, text, opts) {
      await call("sendMessage", {
        chat_id: chatId,
        text,
        ...(opts?.webAppUrl && {
          reply_markup: { inline_keyboard: [[{ text: opts.buttonText ?? "Open", web_app: { url: opts.webAppUrl } }]] },
        }),
      });
    },
  };
}
