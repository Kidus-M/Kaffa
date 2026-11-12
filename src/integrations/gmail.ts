/**
 * Gmail API client with the read-only scope. Lists messages matching the exporter's
 * query (a "kaffa" label by default) and returns their text and PDF attachments.
 * Messages are de-duplicated by Gmail id downstream, so nothing needs to be marked read.
 */
export type RawEmail = {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
  attachments: { fileName: string; mimeType: string; data: string }[];
};

export type GmailClient = { listNew(query: string, max?: number): Promise<RawEmail[]> };

type Part = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[];
  headers?: { name: string; value: string }[];
};

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_PDF_BYTES = 4_000_000;
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function createGmailClient(
  opts: { clientId?: string; clientSecret?: string; refreshToken?: string },
  f: typeof fetch = fetch,
): GmailClient | null {
  if (!opts.clientId || !opts.clientSecret || !opts.refreshToken) return null;
  const creds = { client_id: opts.clientId, client_secret: opts.clientSecret, refresh_token: opts.refreshToken };

  async function accessToken(): Promise<string> {
    const res = await f("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...creds, grant_type: "refresh_token" }),
    });
    if (!res.ok) throw new Error(`Gmail token refresh failed with ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  return {
    async listNew(query, max = 10) {
      const token = await accessToken();
      const get = async <T,>(path: string) => {
        const res = await f(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Gmail request failed with ${res.status}`);
        return (await res.json()) as T;
      };
      const list = await get<{ messages?: { id: string }[] }>(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
      const out: RawEmail[] = [];
      for (const { id } of list.messages ?? []) {
        const msg = await get<{ id: string; internalDate: string; payload: Part }>(`/messages/${id}?format=full`);
        const header = (n: string) => msg.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
        const texts: string[] = [];
        const attachments: RawEmail["attachments"] = [];
        const walk = async (p: Part) => {
          if (p.mimeType === "text/plain" && p.body?.data) texts.push(fromB64url(p.body.data).toString("utf8"));
          if (p.mimeType === "application/pdf" && p.body?.attachmentId && (p.body.size ?? 0) < MAX_PDF_BYTES) {
            const a = await get<{ data: string }>(`/messages/${id}/attachments/${p.body.attachmentId}`);
            attachments.push({ fileName: p.filename || "attachment.pdf", mimeType: p.mimeType, data: fromB64url(a.data).toString("base64") });
          }
          for (const c of p.parts ?? []) await walk(c);
        };
        await walk(msg.payload);
        out.push({
          messageId: msg.id,
          from: header("from"),
          subject: header("subject"),
          receivedAt: new Date(Number(msg.internalDate)).toISOString(),
          body: texts.join("\n").slice(0, 20_000),
          attachments,
        });
      }
      return out;
    },
  };
}
