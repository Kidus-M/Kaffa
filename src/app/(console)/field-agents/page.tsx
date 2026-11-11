import { Suspense } from "react";
import { Link2 } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { env } from "@/config/env";
import { consoleContext } from "@/lib/console";
import { getFieldAgents } from "@/lib/queries";

export const metadata = { title: "Field agents" };

export default function FieldAgentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Field agents"
        description="Each field agent connects once through a personal Telegram link. After that, Kaffa chases them in Amharic and reads their replies."
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

async function Agents() {
  const { db, orgId } = await consoleContext();
  const agents = await getFieldAgents(db, orgId);
  const bot = env().TELEGRAM_BOT_USERNAME;
  return (
    <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
      {agents.map((a) => (
        <Card as="article" key={a.id} className="flex flex-col">
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
                    {m.direction === "out" ? "Kaffa" : "Field agent"},{" "}
                    {new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))
            ) : (
              <p className="m-auto text-[13px] text-ink-faint">No messages yet.</p>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
