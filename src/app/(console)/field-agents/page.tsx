import { Suspense } from "react";
import { env } from "@/config/env";
import { consoleContext } from "@/lib/console";
import { getFieldAgents } from "@/lib/queries";

export const metadata = { title: "Field agents" };

export default function FieldAgentsPage() {
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Field agents</h1>
        <p className="mt-2 text-ink-soft">
          Each field agent connects once through their personal Telegram link. After that, Kaffa chases them in Amharic and reads their replies.
        </p>
      </header>
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Agents />
      </Suspense>
    </div>
  );
}

async function Agents() {
  const { db, orgId } = await consoleContext();
  const agents = await getFieldAgents(db, orgId);
  const bot = env().TELEGRAM_BOT_USERNAME;
  return (
    <ul className="flex flex-col gap-5">
      {agents.map((a) => (
        <li key={a.id} className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{a.name}</h2>
            <span className={a.telegramChatId ? "text-sm text-clear" : "text-sm text-review"}>
              {a.telegramChatId ? "Connected on Telegram" : "Not connected yet"}
            </span>
          </div>
          {!a.telegramChatId ? (
            <p className="text-sm text-ink-soft">
              Personal link:{" "}
              {bot ? (
                <a className="break-all text-canopy underline" href={`https://t.me/${bot}?start=${a.registrationToken}`}>
                  t.me/{bot}?start={a.registrationToken}
                </a>
              ) : (
                <>set TELEGRAM_BOT_USERNAME to show it (token {a.registrationToken}).</>
              )}
            </p>
          ) : null}
          {a.messages.length ? (
            <ol className="flex flex-col gap-2">
              {a.messages.map((m) => (
                <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-line ${m.direction === "out" ? "self-end bg-canopy-soft" : "self-start border border-rule bg-white"}`}>
                  <span lang={m.direction === "out" ? "am" : undefined}>{m.text ?? (m.kind === "location" ? "Shared a location" : m.kind)}</span>
                  <span className="mt-1 block text-xs text-ink-soft">
                    {m.direction === "out" ? "Kaffa" : "Field agent"}, {new Date(m.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-soft">No messages yet.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
