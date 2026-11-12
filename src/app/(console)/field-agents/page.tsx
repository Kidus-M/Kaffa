import { Suspense } from "react";
import { CalendarArrowDown, CloudRain, Link2, Route, Send } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { Card, PageHeader } from "@/components/ui";
import { env } from "@/config/env";
import { consoleContext } from "@/lib/console";
import { dayMonth, getFieldAgents } from "@/lib/queries";
import { getVisitPlans, type StoredPlan } from "@/services/visits";
import { planVisitsAction, sendDayPlansAction } from "../actions";

export const metadata = { title: "Field agents" };

export default function FieldAgentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Field agents"
        description="Each field agent connects once through a personal Telegram link. Kaffa chases them in Amharic, reads their replies, and plans their farm visits around road times and rain."
        actions={
          <>
            <ActionButton action={planVisitsAction} label="Plan visits" pendingLabel="Planning" icon={<Route className="size-4" />} />
            <ActionButton action={sendDayPlansAction} label="Send day plans" pendingLabel="Sending" variant="primary" icon={<Send className="size-4" />} />
          </>
        }
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <Agents />
      </Suspense>
    </div>
  );
}

const initials = (name: string) =>
  name
    .replace(" (synthetic)", "")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

const clock = (minute: number) => {
  const t = 8 * 60 + minute;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

async function Agents() {
  const { db, orgId } = await consoleContext();
  const [agents, plans] = await Promise.all([getFieldAgents(db, orgId), getVisitPlans(db, orgId)]);
  const bot = env().TELEGRAM_BOT_USERNAME;
  return (
    <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
      {agents.map((a) => {
        const plan = plans.find((p) => p.fieldAgentId === a.id);
        return (
          <Card as="article" key={a.id} className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 p-6 pb-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-leaf-wash text-sm font-semibold text-leaf-ink">{initials(a.name)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-medium">{a.name.replace(" (synthetic)", "")}</h2>
                <p className={`text-[13px] ${a.telegramChatId ? "text-clear" : "text-review"}`}>{a.telegramChatId ? "Connected on Telegram" : "Not connected yet"}</p>
              </div>
            </div>
            {!a.telegramChatId ? (
              <div className="mx-6 mb-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-page px-3 py-2.5 text-[13px] text-ink-soft">
                <Link2 className="mt-0.5 size-3.5 shrink-0" />
                {bot ? (
                  <a className="break-all text-ink underline underline-offset-2" href={`https://t.me/${bot}?start=${a.registrationToken}`}>
                    t.me/{bot}?start={a.registrationToken}
                  </a>
                ) : (
                  <span>Set TELEGRAM_BOT_USERNAME to show this agent&apos;s personal link.</span>
                )}
              </div>
            ) : null}

            <VisitPlan agentId={a.id} plan={plan?.plan} sentAt={plan?.sentAt ?? null} />

            <div className="flex min-h-40 flex-1 flex-col gap-2 border-t border-hairline bg-page/60 p-4">
              {a.messages.length ? (
                a.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[88%] rounded-[16px] px-3.5 py-2.5 text-sm whitespace-pre-line ${
                      m.direction === "out" ? "self-end rounded-br-[6px] bg-surface shadow-[var(--shadow-card)]" : "self-start rounded-bl-[6px] bg-leaf-wash"
                    }`}
                  >
                    <span lang={m.direction === "out" ? "am" : undefined} className={m.direction === "out" ? "font-amharic" : undefined}>
                      {m.text ?? (m.kind === "location" ? "Shared a location" : m.kind)}
                    </span>
                    <span className="mt-1 block text-[11px] text-ink-faint">
                      {m.direction === "out" ? (m.kind === "day_plan" ? "Kaffa, day plan" : "Kaffa") : "Field agent"},{" "}
                      {new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))
              ) : (
                <p className="m-auto text-[13px] text-ink-faint">No messages yet.</p>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function VisitPlan({ agentId, plan, sentAt }: { agentId: string; plan?: StoredPlan; sentAt: string | null }) {
  if (!plan) {
    return <p className="border-t border-hairline px-6 py-4 text-[13px] text-ink-faint">No visits planned. Plan visits to group this agent&apos;s open requests into day routes.</p>;
  }
  return (
    <section className="flex flex-col gap-3 border-t border-hairline px-6 py-4" aria-label="Visit plan">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Visit plan{sentAt ? <span className="font-normal text-clear"> · first day sent</span> : null}</h3>
        <a href={`/api/visits/${agentId}/calendar`} className="inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
          <CalendarArrowDown className="size-3.5" /> Calendar
        </a>
      </div>
      <ol className="flex flex-col gap-3">
        {plan.days.map((d) => (
          <li key={d.date} className="flex flex-col gap-1.5">
            <p className="flex items-center justify-between text-[13px]">
              <span className="font-medium">{dayMonth(d.date)}</span>
              <span className="text-ink-faint">
                {d.weather ? `${d.weather.precipitationMm} mm rain, ${d.weather.precipitationProbability}%` : ""} · {Math.round(d.travelMinutes)} min driving
              </span>
            </p>
            <ol className="flex flex-wrap gap-1.5">
              {d.stopsDetail.map((s, i) => (
                <li key={s.plotRef} className="rounded-full bg-page px-2.5 py-1 text-[12px] shadow-[inset_0_0_0_1px_var(--color-hairline)]" title={s.needs.join(", ")}>
                  <span className="text-ink-faint">{clock(d.stops[i].arriveMinute)}</span> {s.plotRef}
                  {s.approximate ? <span className="text-review"> ~</span> : null}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
      {plan.skippedDays.length ? (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-soft">
          <CloudRain className="size-3.5" /> Skipped for rain: {plan.skippedDays.map((d) => dayMonth(d.date)).join(", ")}
        </p>
      ) : null}
      {plan.unscheduled.length ? <p className="text-[12px] text-review">Not yet scheduled: {plan.unscheduled.join(", ")}</p> : null}
      <p className="text-[11px] text-ink-faint">
        Roads: {plan.roads === "openrouteservice" ? "openrouteservice" : "straight-line estimates"} · Weather: {plan.weather === "open-meteo" ? "Open-Meteo" : "simulated"}
        {plan.days.some((d) => d.stopsDetail.some((s) => s.approximate)) ? " · ~ location unknown, starts at the cooperative" : ""}
      </p>
    </section>
  );
}
