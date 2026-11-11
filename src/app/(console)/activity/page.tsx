import { Suspense } from "react";
import { consoleContext } from "@/lib/console";
import { getActivity } from "@/lib/queries";

export const metadata = { title: "Agent activity" };

const AGENT_NAME: Record<string, string> = {
  geo_analyst: "Geo analyst",
  field_liaison: "Field liaison",
  intake: "Intake",
};
const KIND_TEXT: Record<string, string> = { model: "Gemini", tool: "Tool", rule: "Rule", note: "Note" };

export default function ActivityPage() {
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Agent activity</h1>
        <p className="mt-2 text-ink-soft">
          Every run, step by step: what each agent read, which tools it called, and which rule decided the outcome.
        </p>
      </header>
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Runs />
      </Suspense>
    </div>
  );
}

async function Runs() {
  const { db, orgId } = await consoleContext();
  const runs = await getActivity(db, orgId, 30);
  if (!runs.length) return <p className="text-ink-soft">No agent has run yet. Run today&apos;s checks from the overview.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {runs.map((r) => (
        <li key={r.id}>
          <details className="group rounded-lg border border-rule bg-sheet">
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <span>
                <span className="font-medium">{AGENT_NAME[r.agent] ?? r.agent}</span>{" "}
                <span className="text-ink-soft">{r.summary ?? r.trigger}</span>
              </span>
              <span className={`text-sm ${r.status === "failed" ? "text-blocked" : "text-ink-soft"}`}>
                {r.status === "failed" ? "Failed, " : ""}
                {new Date(r.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                {r.inputTokens + r.outputTokens ? `, ${(r.inputTokens + r.outputTokens).toLocaleString()} tokens` : ""}
              </span>
            </summary>
            <ol className="flex flex-col gap-3 border-t border-rule px-4 py-3">
              {r.steps.map((s) => (
                <li key={s.id} className="flex flex-col gap-1 text-sm">
                  <span>
                    <span className="font-medium">{KIND_TEXT[s.kind]}: {s.name.replaceAll("_", " ")}</span>
                    {s.ms ? <span className="text-ink-soft"> in {s.ms} ms</span> : null}
                  </span>
                  <pre className="overflow-x-auto rounded bg-paper p-2 text-xs leading-relaxed text-ink-soft">
                    {JSON.stringify(s.output, null, 1)}
                  </pre>
                </li>
              ))}
            </ol>
          </details>
        </li>
      ))}
    </ul>
  );
}
