# Kaffa

An AI compliance team for Ethiopian coffee exporters facing the EU deforestation regulation (EUDR), which applies from 30 December 2026.

Kaffa finds the farm data that blocks each EU shipment, screens every plot against satellite data, chases field agents on Telegram in Amharic, lets them fix a farm boundary by walking it with GPS, and gives buyers evidence in the EU's official upload format. Fixed rules decide compliance status; Gemini only reads and writes text; a person approves anything with legal weight; every action lands on a tamper-evident ledger.

Design document: [docs/Kaffa-Solution-Design-v2.pdf](docs/Kaffa-Solution-Design-v2.pdf). Decisions and trade-offs: [docs/decisions.md](docs/decisions.md). Build plan: [docs/plans/2026-11-11-kaffa-tier1.md](docs/plans/2026-11-11-kaffa-tier1.md).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. A fresh local database (PGlite, in `.data/`) seeds itself with synthetic demo data on first load, so no account or key is needed. Press **Run today's checks** to screen every plot.

Every integration key is optional. Without a key, that integration runs simulated or from templates, and the sidebar says so:

| Key | Without it |
| --- | --- |
| `GFW_API_KEY` | Satellite results are simulated, deterministically per plot, and labelled |
| `GEMINI_API_KEY` | Chase messages use fixed Amharic and English templates |
| `TELEGRAM_BOT_TOKEN` | Messages are logged, not sent; the Mini App offers a demo picker |
| `INNGEST_EVENT_KEY` | Screening runs inline; multi-day chase waits do not start |
| `DATABASE_URL` | Local PGlite instead of Neon |

See [.env.example](.env.example) for the full list.

## Try the demo

1. **Overview:** each shipment shows its plots as coloured tiles. Run today's checks and watch them fill in.
2. **Plots:** select a plot to see each satellite source's verdict, the rule that decided its status, and 2020 versus 2025 imagery.
3. **Field app:** open `/field` on a phone-sized window, continue as Dawit, and simulate walking KNG-011, a 6 ha farm recorded as a single point. It becomes a valid boundary and is re-screened.
4. **Buyer portal:** from a shipment card, open the buyer's view and download the EU GeoJSON and the due diligence data sheet.
5. **Agent activity:** every agent run, step by step.

## How it is built

```
src/domain        Pure rules: geometry, status, lots, EU export, forecast, ledger (no I/O)
src/integrations  Thin clients: Global Forest Watch, Gemini, Telegram
src/agents        Field liaison: chase messages and reply reading
src/services      Screening, chasing, field inbound, Mini App, exports
src/workflows     Inngest durable workflows: screening, the chase loop, the daily run
src/db            Drizzle schema, ledger-backed event writer, synthetic seed
src/app           Console, buyer portal, Mini App, API routes
```

- **Compliance status is set only in `src/domain/status.ts`.** Agents read statuses; no agent tool writes one.
- **The chase is a durable workflow:** message, wait up to 48 hours for a reply, remind, wait again, escalate to the exporter at 96 hours. Waits cost nothing and survive deployments.
- **The ledger** hashes each event with the previous event's hash (SHA-256), so editing history breaks the chain. The console, portal and data sheets show the current head.
- **The forecast** runs 10,000 seeded simulations of each field agent's past response times to give a chance of shipping on time.

## Tests

```bash
npm test
```

121 tests cover the EUDR geometry rules (including holes, figure-eight shapes, 6-decimal truncation and swapped coordinates), status and lot rules, the EU export format, the forecast, the ledger, Telegram signature checks, the chase workflow, and database-backed services on an in-memory Postgres.

## Deploy

1. Create a Neon database (free) and set `DATABASE_URL`, then run `npm run db:migrate` and `npm run db:seed`.
2. Deploy to Vercel (Hobby). `vercel.json` schedules the daily run at 06:00 Addis Ababa time; set `CRON_SECRET`.
3. Connect Inngest (free) and set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
4. Create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and a random `TELEGRAM_WEBHOOK_SECRET`, then register the webhook:

   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=$APP_URL/api/telegram/webhook" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```

   In @BotFather, set the bot's Mini App URL to `$APP_URL/field`.

## Honest limits

- All farms, cooperatives and buyers are synthetic. Plots sit at real locations, so live satellite checks return real results.
- The Tier 1 console has no sign-in and serves one demo organisation. Do not load real farm data before sign-in and roles ship.
- Satellite imagery is EOX Sentinel-2 cloudless, free for non-commercial use with attribution.
- Kaffa's output supports a buyer's due diligence. It is not a legal determination of compliance.
