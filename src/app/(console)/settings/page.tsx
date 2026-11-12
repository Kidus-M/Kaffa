import { Suspense } from "react";
import { Lock } from "lucide-react";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import * as policy from "@/config/policy";
import { AUTONOMY_ACTIONS, autonomyMode, type AutonomyMode } from "@/domain/autonomy";
import { consoleContext } from "@/lib/console";
import { getPolicies } from "@/services/autonomy";
import { integrationStatus } from "@/services/deps";
import { setAutonomyAction } from "../actions";

export const metadata = { title: "Settings" };

const MODES: { mode: AutonomyMode; label: string }[] = [
  { mode: "auto", label: "Automatic" },
  { mode: "ask", label: "Ask first" },
  { mode: "off", label: "Off" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Settings"
        description="How much the agents may do alone, and the thresholds behind every rule. Actions with legal weight always ask a person, whatever is set here."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <Autonomy />
      </Suspense>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Rules />
        <Services />
      </div>
    </div>
  );
}

async function Autonomy() {
  const { db, orgId } = await consoleContext();
  const stored = await getPolicies(db, orgId);
  return (
    <Card aria-labelledby="autonomy">
      <CardHeader id="autonomy" title="Autonomy" meta="Every change goes on the ledger" />
      <ul className="flex flex-col divide-y divide-hairline px-6 pt-3 pb-3">
        {AUTONOMY_ACTIONS.map((a) => {
          const current = autonomyMode(a.id, stored);
          return (
            <li key={a.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[15px]">{a.label}</p>
                <p className="text-[13px] text-ink-faint">
                  {a.agent}
                  {"note" in a && a.note ? ` · ${a.note}` : ""}
                </p>
              </div>
              {a.locked ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-ink-soft">
                  <Lock className="size-3.5" /> Always asks first
                </span>
              ) : (
                <form action={setAutonomyAction} className="flex shrink-0 rounded-full bg-sunken p-1" role="radiogroup" aria-label={a.label}>
                  <input type="hidden" name="action" value={a.id} />
                  {MODES.map((m) => (
                    <button
                      key={m.mode}
                      name="mode"
                      value={m.mode}
                      role="radio"
                      aria-checked={current === m.mode}
                      className={`h-8 rounded-full px-3.5 text-[13px] transition-colors ${
                        current === m.mode ? "bg-surface font-medium text-ink shadow-[var(--shadow-card)]" : "text-ink-soft hover:text-ink"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Rules() {
  const rows: [string, string][] = [
    ["Rules version", policy.RULES_VERSION],
    ["Deforestation cut-off", "31 December 2020"],
    ["Blocked when loss after cut-off is at least", `${policy.BLOCK_FRACTION * 100}% of the plot or ${policy.BLOCK_HA} ha, whichever is lower`],
    ["Polygon required above", `${policy.POLYGON_REQUIRED_ABOVE_HA} ha`],
    ["Satellite sources needed to clear a plot", policy.REQUIRED_SOURCES.join(", ")],
    ["Propose a farmer merge from", `${Math.round(policy.MERGE_PROPOSE_SCORE * 100)}% match; merge alone from ${Math.round(policy.MERGE_AUTO_SCORE * 100)}% if allowed`],
    ["Plausible yield", `${policy.YIELD_KG_PER_HA.default} kg/ha green coffee, with ${Math.round((policy.YIELD_TOLERANCE - 1) * 100)}% headroom`],
    ["Remind, then escalate after", `${policy.CHASE_REMINDER_HOURS} h, then ${policy.CHASE_ESCALATE_HOURS} h`],
    ["Messages per field agent per day", String(policy.DAILY_MESSAGE_CAP)],
    ["Skip a visit day when rain is at least", `${policy.RAIN_SKIP_MM} mm or ${policy.RAIN_SKIP_PROBABILITY}% likely`],
    ["Forecast simulations", `${policy.FORECAST_RUNS.toLocaleString()}, seeded`],
  ];
  return (
    <Card aria-labelledby="rules">
      <CardHeader id="rules" title="Rules" meta="Versioned in code; design choices, not legal figures" />
      <dl className="grid gap-x-6 gap-y-3 px-6 pt-4 pb-6 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-soft">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const SERVICE: Record<string, string> = {
  satellite: "Global Forest Watch",
  gemini: "Gemini",
  telegram: "Telegram bot",
  workflows: "Inngest workflows",
  database: "Database",
  roads: "openrouteservice road times",
  weather: "Open-Meteo rain forecast",
  inbox: "Gmail buyer inbox",
  outbound: "Brevo outbound email",
};

function Services() {
  const s = integrationStatus();
  return (
    <Card aria-labelledby="services">
      <CardHeader id="services" title="Connected services" meta="All on free plans" />
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 px-6 pt-4 pb-6 text-sm">
        {Object.entries(s).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-soft">{SERVICE[k] ?? k}</dt>
            <dd className={["live", "durable", "neon", "open-meteo"].includes(v) ? "text-clear" : "text-review"}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="px-6 pb-6 text-[13px] text-ink-faint">A missing key switches that service to labelled sample data or templates. Add keys in the environment; see .env.example.</p>
    </Card>
  );
}
