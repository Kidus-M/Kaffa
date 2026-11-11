# Decisions and rulings

Each entry: what was decided, why, and what it costs if wrong. Plan: `docs/plans/2026-11-11-kaffa-tier1.md`.

- **Branch:** work happens on `feat/tier1`; `main` holds only the scaffold. Why: keeps a reviewable range. Cost if wrong: none.
- **Local database is PGlite, production is Neon.** Why: the app runs with zero setup for a reviewer, and one Drizzle schema serves both. Cost if wrong: driver-specific bugs, caught by running the same tests against Neon.
- **Plot geometry is stored as GeoJSON `jsonb` plus bounding-box columns, not a PostGIS column.** Why: PGlite has no PostGIS, and overlap checks run in `src/domain/geometry.ts` with a bbox prefilter, which is fast enough for one exporter's plots and keeps all rules in one tested place. Deviation from the spec's "PostGIS finds overlapping plots". Cost if wrong: overlap checks slow down past tens of thousands of plots; PostGIS can be added on Neon later without changing the domain API.
- **Hole splitting uses Turf `intersect` with two half-plane rectangles**, not an extra clipping library. Why: Turf 7 already ships a robust clipper; one dependency fewer. Cost if wrong: none expected.
- **Every integration key is optional.** Without a key the integration uses recorded fixtures and the UI labels it simulated. Why: the demo must run end to end on any machine. Cost if wrong: a reviewer could mistake fixtures for live data, so the label is mandatory.
- **A holed plot exports as one MultiPolygon feature, not two Polygon features** (the plan said "two Polygons"). Why: one plot stays one feature with one ProductionPlace, which keeps traceability, and the EU format accepts MultiPolygon. Cost if wrong: a one-line change in `eu-export.ts`.
- **Forecast samples a delay for every open gap, not one per field agent.** Why: an agent with ten open plots should finish later than one with a single plot; one draw per agent would ignore backlog. Cost if wrong: forecasts are pessimistic for agents who fix many plots in one trip; tune with real response data.
- **Clear evidence of loss blocks a plot even when another required source is down.** Why: failing safe never needs more data; only clearing a plot needs every source. Cost if wrong: none, a blocked plot is reviewed by a person anyway.
- **Export repairs only what does not move the boundary** (closing rings, removing duplicate corners, splitting holes). Swapped coordinates are rejected for a person to confirm. Why: matches the autonomy rules in the spec. Cost if wrong: a few extra approvals.
- **Mini App init data is accepted whether or not the client included Telegram's newer `signature` field in the HMAC.** Why: Telegram's docs say "all received fields" while its third-party method excludes it; both variants still need the bot token, so neither weakens verification. Cost if wrong: none for security.
- **Gemini's chase message is used only if it keeps every plot reference; otherwise the fixed template goes out.** Why: a model that drops a plot silently breaks the chase. Cost if wrong: slightly less natural wording.
- **Reply intents gained `photo`** beyond the plan's list, because photos are a separate kind of evidence for review plots. Cost if wrong: none.
- **An open field request holds its lot, even when every plot is clear.** Why: an overlap means two farmers claim the same land, which a buyer cannot accept; the plan's lot rule only looked at statuses. Cost if wrong: lots wait for field fixes a person might have waived; the exporter can resolve the request.
- **Plots carry a responsible field agent (`plots.field_agent_id`).** Why: screening must know who to ask for photos of a review plot; the plan's schema only linked agents through requests. Cost if wrong: none.
- **Global Forest Watch queries use the `latest` dataset version and the field names from the OpenEPI guide.** These must be confirmed against `/dataset/{id}/latest/fields` once a key exists. Cost if wrong: live queries fail and plots stay "not checked", never wrongly cleared.
- **The chase's control flow is a plain function (`runChase`) that receives Inngest's step tools.** Why: `@inngest/test` 1.0 mis-handles event waits under Inngest 4 (results came back undefined), and the separation makes the flow testable with a ten-line fake. Cost if wrong: none; production passes Inngest's real step object.
- **When Inngest is unreachable, plot screening runs inline.** Why: the demo must work without the Inngest dev server; multi-day waits simply don't start, and the console shows workflows as "inline". Cost if wrong: slower requests in that mode only.
- **The daily cron runs at 03:00 UTC (06:00 in Addis Ababa)**, before the exporter's working day.
- **Typeface: Instrument Sans, with Noto Sans Ethiopic for Amharic.** Schibsted Grotesk was tried first, but its punctuation rendered with visible gaps on Windows. Colour is reserved for status: green clear, amber review, cherry red blocked, slate not checked.
- **A shipment with blocked plots shows the blocked count instead of an on-time percentage.** Why: blocked plots need the exporter's decision, not field work, so a probability would mislead. Cost if wrong: none.
- **Tier 1 console has no sign-in and serves only the synthetic demo organisation**; every table is already scoped by organisation, and sign-in with roles is Tier 2. Cost if wrong: do not load real farm data into a public deployment before Tier 2.
- **Imagery compares 2020 with 2025 on one map with a fade slider**, not two synced maps. Why: 2020 is the EUDR cut-off year; one map is simpler and more robust. Imagery is capped at zoom 14, the highest EOX serves, and upscaled beyond that. The MapLibre worker is served from `public/` because Turbopack does not bundle it; `postinstall` keeps the copy current.
- **Security fix: the Mini App's demo picker fails closed.** It works only in development or with `DEMO_MODE=1` in production, never alongside a bot token, and only for synthetic field agents in the demo organisation. Found by an automated security review: before this, a production deployment without a bot token would have let anyone act as any field agent.

## Final review fix pass

A fresh reviewer checked the whole branch. Each fix below has a test that failed first.

- **Fixed (critical):** a near-collinear ring passed validation because its area after truncation was floating-point residue, not zero. Rings under 1 m² now count as collapsed.
- **Fixed:** accepted review plots were re-held by the next daily run. Accepting a review now closes its photo requests, and screening opens no new photo request for an accepted review or one whose photo already arrived.
- **Fixed:** a failed Telegram update was marked as seen, so Telegram's retry was dropped. The marker is now removed on failure, and an unparseable Gemini response counts as Gemini being unavailable.
- **Fixed:** GPS jitter at a corner rejected a valid walk. Fixes within their own accuracy of the last point are dropped, and crossings are checked after simplification.
- **Fixed:** an out-and-back walk along a line closed a boundary request. Walks under 100 m² are rejected as too small, and degenerate tracks no longer crash.
- **Fixed:** a re-walked boundary was not re-checked for overlaps. Recapture now checks neighbours and keeps the overlap request open if the new shape still overlaps.
- **Fixed:** held lots could be downloaded, and refused plots were left out silently. Exports now require a ready lot and are all-or-nothing; the portal shows downloads only for ready lots.
- **Added:** the exporter can remove a blocked plot from its lot, with a reason on the ledger. This is the simplest form of the design's lot split, and without it a lot with a blocked plot could never ship.
- **Fixed:** chase runs piled up behind the per-agent concurrency limit. The workflow is now a singleton per field agent that skips new requests while one runs.
- **Fixed (promoted from minor because it is a security issue):** a registration link worked forever. The token now rotates on first use.
- Minor, deferred: the forecast ignores held plots that have no open request, such as a received photo awaiting a decision.
- Minor, deferred: a location reply to a "confirm" request on a swapped polygon replaces the polygon with a point.
- Minor, deferred: a status change and its ledger entry are written in separate transactions.
- Minor, deferred: approving a `review_photo` approval does not itself accept the review; the exporter accepts on the plot page.
- Minor, deferred: the daily message cap counts acknowledgement messages too.

## Intake (Tier 1, task 13)

- **Spreadsheets are read without AI; photos go to Gemini.** Excel and CSV cells are typed data, so they get full confidence; only a non-number where a number belongs gets zero. Photos are transcribed by Gemini with a confidence per field, told to copy rather than guess and to treat the image as data.
- **A row becomes a plot only if every field is at least 80% certain and farmer, area and coordinates are present.** Everything else waits on the Intake page, where a person corrects or rejects it. Corrected values count as certain. Cost if wrong: more rows to check by hand, never a silently wrong plot.
- **New plots go to the cooperative's field agent with the fewest plots,** take the cooperative's next reference number, and keep Amharic names in Ge'ez script.
- **Fixed (found while verifying intake): the local database existed twice in one server process.** Next.js bundles route handlers and pages separately, so module-level singletons are not shared; uploads, Telegram replies and Mini App walks wrote to one in-memory PGlite and the console read another. The database now lives on `globalThis`. Production on Neon was not affected.

## Interface redesign

- **Sidebar modelled on Adaption's app, in Kaffa's own identity.** A floating icon rail that expands over the page on hover or keyboard focus into stacked cards: navigation with counts, a data-sources card that says what is simulated, and the organisation. It becomes a top bar with a drawer on small screens. Kaffa's own coffee-bean mark, Lucide icons and green replace Adaption's branding.
- **Layout follows published practice from Linear and dashboard research:** neutral surfaces with colour reserved for status, elevation instead of heavy borders, one headline answer per page (lots ready to ship), and progressive disclosure through status tiles that link to filtered plot lists.
- **Typeface: Geist,** light weights for headings and regular for text, with Noto Sans Ethiopic for Amharic.
- **The sidebar's loading state is a static skeleton,** because reading the URL in a Suspense fallback blocks prerendering in Next.js 16.
