import { describe, expect, it } from "vitest";
import { handleTelegramWebhook } from "./webhook";

const update = { update_id: 1, message: { chat: { id: 5 }, from: { id: 5 }, text: "hi" } };
const req = (secret: string | null, body: unknown = update) =>
  new Request("https://kaffa.example/api/telegram/webhook", {
    method: "POST",
    headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
    body: JSON.stringify(body),
  });

describe("handleTelegramWebhook", () => {
  const handled: unknown[] = [];
  const handle = async (m: unknown) => void handled.push(m);

  it("rejects a request without the right secret", async () => {
    expect((await handleTelegramWebhook(req("wrong"), { secret: "right-secret", handle })).status).toBe(401);
    expect((await handleTelegramWebhook(req(null), { secret: "right-secret", handle })).status).toBe(401);
    expect(handled).toHaveLength(0);
  });

  it("refuses to run when no secret is configured", async () => {
    expect((await handleTelegramWebhook(req("x"), { secret: undefined, handle })).status).toBe(503);
  });

  it("hands a valid update to the handler and answers 200", async () => {
    const res = await handleTelegramWebhook(req("right-secret"), { secret: "right-secret", handle });
    expect(res.status).toBe(200);
    expect(handled).toHaveLength(1);
  });

  it("acknowledges updates it does not handle, so Telegram stops retrying", async () => {
    const res = await handleTelegramWebhook(req("right-secret", { update_id: 2, edited_message: {} }), { secret: "right-secret", handle });
    expect(res.status).toBe(200);
    expect(handled).toHaveLength(1);
  });

  it("answers 400 to a body that is not JSON", async () => {
    const bad = new Request("https://kaffa.example/x", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "right-secret" },
      body: "{not json",
    });
    expect((await handleTelegramWebhook(bad, { secret: "right-secret", handle })).status).toBe(400);
  });
});
