# Kaffa

An AI compliance team for Ethiopian coffee exporters facing the EU deforestation regulation (EUDR), which applies from 30 December 2026.

Kaffa takes every EU-bound lot from messy farm records to a buyer-ready evidence pack. Seven agents share one evidence store:

- **Intake** reads registers, photos and buyer emails, and catches farmers recorded twice under Amharic and Latin spellings.
- **Geo analyst** validates every plot against the EU's GeoJSON rules and screens it against satellite data.
- **Field liaison** chases field agents on Telegram in Amharic. They fix a boundary by walking it with GPS in a Mini App.
- **Field planner** turns open requests into day routes around road times and rain.
- **Supply chain auditor** traces every kilogram from farm to container and holds lots holding coffee no mapped farm could have grown.
- **Shipment planner** forecasts the chance each contract ships on time and re-solves the container plan when a lot is held.
- **Buyer liaison** runs the buyer portal and answers questions with a citation on every sentence.

Fixed rules decide compliance status; Gemini only reads and writes text. A person approves anything with legal or commercial weight, and every action lands on a tamper-evident ledger.

Design document: [docs/Kaffa-Solution-Design-v2.pdf](docs/Kaffa-Solution-Design-v2.pdf). Decisions and trade-offs: [docs/decisions.md](docs/decisions.md). Keys: [docs/keys-setup.md](docs/keys-setup.md). Demo script: [docs/demo-script.md](docs/demo-script.md).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. A fresh local database (PGlite, in `.data/`) seeds itself with synthetic demo data on first load, so no account or key is needed.

Every integration key is optional. Without a key, that integration runs simulated or from templates, and the sidebar's data-sources card says so:

| Service (free plan) | Used for | Without its key |
| --- | --- | --- |
| Global Forest Watch | Tree cover loss and deforestation alerts | Deterministic simulated results, labelled |
| Gemini | Photos, emails, Amharic replies, cited answers, embeddings | Templates and rule-based readers |
| Telegram | Chasing field agents, day plans, the Mini App | Messages logged, Mini App demo picker |
| openrouteservice | Road travel times for visit routes | Straight-line estimates, labelled |
| Open-Meteo | Rain forecast for visit days | Needs no key; simulated if unreachable |
| Gmail (read-only) | Buyer emails become contracts and questions | Three recorded synthetic emails |
| Brevo | Sending approved replies | Approved replies recorded, not sent |
| Inngest | Durable chase waits and the daily run | Screening runs inline |
| Neon | Production Postgres | Local PGlite |

## Try the demo

1. **Overview:** the morning brief lists the three decisions that matter today. Run today's checks and watch the plot tiles fill in.
2. **Supply chain:** HMB-L4 is held. One farmer delivered 4.7 t from a 2 ha farm, and 600 kg came from a supplier with no mapped plot. The custody graph shows both in red.
3. **Shipments:** the planner proposes swapping the spare lot KNG-L5 in for HMB-L4, which lifts Antwerp's chance of shipping on time from 5% to 100%. Re-plan containers, then approve it.
4. **Intake:** upload `public/samples/konga-register.csv`. "Tesfaie Girma" is caught as the farmer already on record as ተስፋዬ ግርማ. Load the sample inbox: a contract becomes a proposed shipment, a buyer question gets a cited draft reply, and an injection attempt is ignored.
5. **Approvals:** confirm the duplicate farmer, approve the new contract, and the planner allocates spare lots to it.
6. **Field agents:** plan visits. Each agent gets day routes, with a rainy day skipped and a calendar file to download.
7. **Buyer portal:** ask "How long do you keep the due diligence records?" and get an answer citing Article 12. Scan a lot's QR code to reach its public verification page, which recomputes the ledger on every visit.
8. **Ask Kaffa** (bottom right, every page): "Why is the Antwerp shipment at risk?"
9. **Settings:** set how much each agent may do alone. Legal actions stay locked to "ask first".

## How it is built

```
src/domain        Pure rules and algorithms, no I/O: geometry, status, lots, EU export, forecast,
                  ledger, identity matching, custody and volume checks, container planner,
                  route solver, retrieval and citation checks, autonomy
src/integrations  Thin clients: Global Forest Watch, Gemini, Telegram, openrouteservice,
                  Open-Meteo, Gmail, Brevo
src/agents        Intake (registers, emails), field liaison (chase messages, reply reading)
src/knowledge     The regulation's passages for cited answers
src/services      Database-backed agent work: screening, chasing, identity, custody audit,
                  planner, visits, copilot, email intake, approvals, morning brief
src/workflows     Inngest durable workflows: screening, the chase loop, the daily run
src/db            Drizzle schema, ledger-backed event writer, synthetic seed
src/app           Console, buyer portal, public verification page, Mini App, API routes
evals             Golden sets and thresholds for the agent evaluation suite
```

- **Compliance status is set only in `src/domain/status.ts`.** Agents read statuses; no agent tool writes one.
- **The chase is a durable workflow:** message, wait up to 48 hours for a reply, remind, wait again, escalate to the exporter at 96 hours. Waits cost nothing and survive deployments.
- **The container planner is exact.** Branch-and-bound over lot assignments meets every contract's volume and grade, maximises the expected number of shipments leaving on time, and moves as few lots as possible. Tests check it against brute force.
- **Routes** use nearest-neighbour then 2-opt over road travel times, cut into working days, skipping days with heavy rain forecast.
- **Cited answers** retrieve passages by BM25, fused with Gemini embeddings when available. Every sentence must cite a source the agent was given. Gemini gets one repair attempt; after that, the question goes to a person.
- **The ledger** hashes each event with the previous event's hash (SHA-256), so editing history breaks the chain.

## Tests and evaluations

```bash
npm test          # 215 tests: rules, algorithms, integrations and database-backed services
npm run evals     # the agent evaluation suite, gated by evals/thresholds.json and evals/baseline.json
```

The evaluation suite scores:

- identity matching: precision and recall across scripts
- intake field accuracy
- email reading, by rules and by Gemini
- copilot citations: hit rate, validity, and routing of unsupported questions
- planner optimality against brute force
- route optimality
- field-agent reply reading, including injection attempts

Sets that need Gemini run when `GEMINI_API_KEY` is set. CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, evaluations and the build on every push. A score below its threshold, or more than 0.01 below the baseline, fails the build.

## Deploy

1. Create a Neon database (free) and set `DATABASE_URL`, then run `npm run db:migrate` and `npm run db:seed`.
2. Deploy to Vercel (Hobby). `vercel.json` schedules the daily run at 06:00 Addis Ababa time; set `CRON_SECRET`.
3. Connect Inngest (free) and set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
4. Create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and a random `TELEGRAM_WEBHOOK_SECRET`, then register the webhook:

   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=$APP_URL/api/telegram/webhook" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```

   In @BotFather, set the bot's Mini App URL to `$APP_URL/field`.

Step-by-step instructions for every key are in [docs/keys-setup.md](docs/keys-setup.md).

## Honest limits

- All farms, cooperatives and buyers are synthetic. Plots sit at real locations, so live satellite checks return real results.
- The console has no sign-in and serves one demo organisation. Do not load real farm data before sign-in and roles ship.
- Regulation passages are plain-language summaries with article references, for decision support; the Official Journal text governs.
- The Amharic templates need a native speaker's check before real use.
- Satellite imagery is EOX Sentinel-2 cloudless, free for non-commercial use with attribution.
- Kaffa's output supports a buyer's due diligence. It is not a legal determination of compliance.
