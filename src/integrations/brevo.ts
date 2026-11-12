/** Brevo transactional email (free plan) for replies a person has approved. */
export type Mailer = { send(input: { to: string; subject: string; text: string }): Promise<void> };

export function createMailer(opts: { apiKey?: string; sender?: string }, f: typeof fetch = fetch): Mailer | null {
  if (!opts.apiKey || !opts.sender) return null;
  const { apiKey, sender } = opts;
  return {
    async send({ to, subject, text }) {
      const res = await f("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: { email: sender, name: "Kaffa" }, to: [{ email: to }], subject, textContent: text }),
      });
      if (!res.ok) throw new Error(`Brevo send failed with ${res.status}`);
    },
  };
}

/** "Name <a@b.c>" to "a@b.c". */
export function emailAddress(from: string): string | null {
  return /<([^>]+)>/.exec(from)?.[1] ?? (/^\S+@\S+$/.test(from.trim()) ? from.trim() : null);
}
