# Getting Kaffa's keys

Every key is optional: without one, that integration runs simulated and the sidebar's data-sources card says so. Paste each value into `kaffa/.env.local` (gitignored), then restart `npm run dev`, because the environment is read once at start-up.

`TELEGRAM_WEBHOOK_SECRET` and `CRON_SECRET` are already filled in `.env.local` with random values. `INNGEST_DEV=1` is set for local runs.

Priority for the demo video: 1 Gemini, 2 Global Forest Watch, 3 Telegram with a tunnel, 4 openrouteservice. Gmail, Brevo and Neon are optional.

## 1. Gemini: `GEMINI_API_KEY` (5 minutes)

1. Open https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key**, then pick or create a Google Cloud project.
3. Copy the key into `GEMINI_API_KEY`. Leave `GEMINI_MODEL=gemini-3.5-flash,gemini-3.5-flash-lite` (gemini-2.5-flash is closed to new keys; later models are fallbacks).

The free tier may use prompts for training, so the demo uses only synthetic farms.

## 2. Global Forest Watch: `GFW_API_KEY` (10 minutes)

1. Open https://www.globalforestwatch.org, click **My GFW** (top right) and sign up with email and password. Confirm the email.
2. In PowerShell, get a token and then create a key. Replace the email and password with yours:

```powershell
$t = (Invoke-RestMethod -Method Post -Uri "https://data-api.globalforestwatch.org/auth/token" -Body @{ username = "you@example.com"; password = "your-password" }).data.access_token
(Invoke-RestMethod -Method Post -Uri "https://data-api.globalforestwatch.org/auth/apikey" -Headers @{ Authorization = "Bearer $t" } -ContentType "application/json" -Body '{"alias":"kaffa-dev","email":"you@example.com","organization":"Personal","domains":[]}').data.api_key
```

3. Copy the printed key into `GFW_API_KEY`. Leave `GFW_ORIGIN` empty, because an empty domain list means the key is not tied to one website. Keys expire after a year.

## 3. Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (10 minutes, plus the tunnel)

1. In Telegram, open a chat with **@BotFather** and send `/newbot`.
2. Give it a name (for example "Kaffa Demo"), then a username ending in `bot` (for example `kaffa_demo_bot`).
3. Copy the token BotFather replies with into `TELEGRAM_BOT_TOKEN`, and the username without `@` into `TELEGRAM_BOT_USERNAME`.
4. Telegram can only reach a public HTTPS address, so give your laptop one with a free Cloudflare quick tunnel:

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

5. Copy the `https://….trycloudflare.com` address it prints into `APP_URL`, then restart `npm run dev`.
6. Register the webhook. Use the token and secret from `.env.local`:

```powershell
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" -Body @{ url = "<APP_URL>/api/telegram/webhook"; secret_token = "<TELEGRAM_WEBHOOK_SECRET>" }
```

7. In the console, go to **Field agents** and open an agent's personal `t.me/...` link on your phone to connect as that agent.

A quick tunnel's address changes every time it restarts. When that happens, update `APP_URL` and run step 6 again.

## 4. openrouteservice: `ORS_API_KEY` (5 minutes)

1. Sign up at https://openrouteservice.org/dev/#/signup and confirm your email.
2. Log in, open the **Dashboard**, and under **Request a token** choose type **Standard** with the name `kaffa`. Click **CREATE TOKEN**.
3. Copy the key into `ORS_API_KEY`.

Weather comes from Open-Meteo, which needs no key.

## 5. Inngest, for durable workflows (local, no keys)

Leave `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` empty, keep `INNGEST_DEV=1`, and in a second terminal run:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Its dashboard at http://localhost:8288 shows each chase waiting for a reply.

For a deployment, sign up at https://app.inngest.com and copy the keys:

- **Event key:** from **Manage, Event Keys** into `INNGEST_EVENT_KEY`.
- **Signing key:** from **Manage, Signing Key** into `INNGEST_SIGNING_KEY`.
- **`INNGEST_DEV`:** remove it.

## 6. Gmail intake: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (optional, 20 minutes)

Use a separate Gmail account for the demo.

1. Open https://console.cloud.google.com, create a project called `kaffa`, and select it.
2. Go to **APIs & Services, Library**, search for **Gmail API**, and click **Enable**.
3. Set up **APIs & Services, OAuth consent screen**:
   - Choose user type **External** and fill in the app name and emails.
   - Under **Test users**, add the Gmail account you will read.
   - Leave the app in **Testing**.
4. Create the client under **APIs & Services, Credentials, Create credentials, OAuth client ID**:
   - Choose type **Web application**.
   - Under **Authorized redirect URIs**, add `https://developers.google.com/oauthplayground`.
   - Copy the client ID into `GMAIL_CLIENT_ID` and the client secret into `GMAIL_CLIENT_SECRET`.
5. Open https://developers.google.com/oauthplayground and click the gear icon. Tick **Use your own OAuth credentials**, then paste the client ID and secret.
6. In **Step 1**, type `https://www.googleapis.com/auth/gmail.readonly` in the box and click **Authorize APIs**. Sign in with the test account and allow access.
7. In **Step 2**, click **Exchange authorization code for tokens** and copy the **Refresh token** into `GMAIL_REFRESH_TOKEN`.
8. In that Gmail account, create a label called `kaffa` and put buyer emails under it. `GMAIL_QUERY` reads that label.

In Testing mode, Google expires the refresh token after 7 days. Redo steps 5 to 7 before recording.

## 7. Brevo, for sending approved replies: `BREVO_API_KEY`, `BREVO_SENDER` (optional, 10 minutes)

1. Sign up at https://www.brevo.com (free plan) and finish the account form.
2. Click your name (top right), then **SMTP & API**. On the **API Keys** tab, click **Generate a new API key** and copy it into `BREVO_API_KEY`.
3. Go to **Senders, Domains & Dedicated IPs, Senders, Add a sender**, enter your email, and click the verification link Brevo sends you.
4. Put that verified email in `BREVO_SENDER`.

## 8. Neon Postgres: `DATABASE_URL` (only for a deployment)

Locally, leave it empty: the app uses an embedded database in `.data/pglite`.

For Vercel:

1. Sign up at https://console.neon.tech and create a project in the **AWS Europe (Frankfurt)** region.
2. Click **Connect**, keep **Connection pooling** on, and copy the connection string into `DATABASE_URL`.
3. The scripts don't read `.env.local`, so set the URL in the same PowerShell window first:

```powershell
$env:DATABASE_URL = "<your Neon connection string>"
npm run db:migrate
npm run db:seed
```

## Check it worked

Restart `npm run dev` and expand the sidebar's data-sources card. Each source you configured should now say `live`.
