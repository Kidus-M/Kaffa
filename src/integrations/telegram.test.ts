import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseUpdate, verifyInitData, verifyWebhookSecret } from "./telegram";

const BOT = "123456:TEST-token";

/** Signs Mini App init data the way Telegram does, independently of the code under test. */
function signInitData(fields: Record<string, string>, token = BOT): string {
  const dataCheck = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = 1_794_400_000;
const user = JSON.stringify({ id: 4242, first_name: "Tigist" });

describe("verifyWebhookSecret", () => {
  it("accepts the right secret and rejects a wrong or missing one", () => {
    expect(verifyWebhookSecret("s3cret-value", "s3cret-value")).toBe(true);
    expect(verifyWebhookSecret("s3cret-valuf", "s3cret-value")).toBe(false);
    expect(verifyWebhookSecret(null, "s3cret-value")).toBe(false);
    expect(verifyWebhookSecret("short", "s3cret-value")).toBe(false);
  });
});

describe("verifyInitData", () => {
  it("accepts data signed with the bot token", () => {
    const data = signInitData({ auth_date: String(now - 60), query_id: "AAH", user });
    expect(verifyInitData(data, BOT, { now })).toEqual({ ok: true, userId: 4242, authDate: now - 60 });
  });

  it("accepts data that carries the newer signature field", () => {
    const data = signInitData({ auth_date: String(now - 60), signature: "abc", user });
    expect(verifyInitData(data, BOT, { now }).ok).toBe(true);
  });

  it("rejects a tampered field", () => {
    const data = signInitData({ auth_date: String(now - 60), user }).replace("4242", "9999");
    expect(verifyInitData(data, BOT, { now })).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejects data signed with another bot's token", () => {
    const data = signInitData({ auth_date: String(now - 60), user }, "999:OTHER");
    expect(verifyInitData(data, BOT, { now })).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejects data older than 24 hours", () => {
    const data = signInitData({ auth_date: String(now - 86_401), user });
    expect(verifyInitData(data, BOT, { now })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed data", () => {
    expect(verifyInitData("not-init-data", BOT, { now })).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("parseUpdate", () => {
  const base = { update_id: 77, message: { message_id: 1, chat: { id: 4242 }, from: { id: 4242 }, date: now } };

  it("reads a start link payload", () => {
    expect(parseUpdate({ ...base, message: { ...base.message, text: "/start fa-tigist-7d1c" } })).toMatchObject({
      updateId: 77,
      chatId: 4242,
      kind: "start",
      startPayload: "fa-tigist-7d1c",
    });
  });

  it("reads a location, a photo and plain text", () => {
    expect(parseUpdate({ ...base, message: { ...base.message, location: { latitude: 6.1, longitude: 38.2 } } })).toMatchObject({
      kind: "location",
      location: { lat: 6.1, lon: 38.2 },
    });
    expect(
      parseUpdate({ ...base, message: { ...base.message, photo: [{ file_id: "small" }, { file_id: "large" }] } }),
    ).toMatchObject({ kind: "photo", fileId: "large" });
    expect(parseUpdate({ ...base, message: { ...base.message, text: "ok" } })).toMatchObject({ kind: "text", text: "ok" });
  });

  it("ignores updates that are not messages", () => {
    expect(parseUpdate({ update_id: 5, edited_message: {} })).toBeNull();
    expect(parseUpdate("junk")).toBeNull();
  });
});
