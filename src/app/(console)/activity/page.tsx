import { Suspense } from "react";
import { Bot, Cpu, Scale, StickyNote, Wrench } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { consoleContext } from "@/lib/console";
import { getActivity } from "@/lib/queries";

export const metadata = { title: "Agent activity" };

const AGENT_NAME: Record<string, string> = {
  geo_analyst: "Geo analyst",
  field_liaison: "Field liaison",
  intake: "Intake",
  field_planner: "Field planner",
  supply_chain_auditor: "Supply chain auditor",
  shipment_planner: "Shipment planner",
  buyer_liaison: "Buyer liaison",
  copilot: "Ask Kaffa",
};
const STEP = {
  model: { label: "Gemini", icon: Cpu },
  tool: { label: "Tool", icon: Wrench },
  rule: { label: "Rule", icon: Scale },
  note: { label: "Note", icon: StickyNote },
} as const;

export default function ActivityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Agent activity" description="Every agent run, step by step: what it read, which tools it called, and which rule decided the outcome." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <Runs />
      </Suspense>
    </div>
  );
}

async function Runs() {
  const { db, orgId } = await consoleContext();
  const runs = await getActivity(db, orgId, 30);
  if (!runs.length) return <EmptyState title="No agent has run yet">Run today&apos;s checks from the overview.</EmptyState>;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-hairline">
        {runs.map((r) => (
          <li key={r.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-4 px-6 py-4 transition-colors hover:bg-page [&::-webkit-details-marker]:hidden">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-page shadow-[inset_0_0_0_1px_var(--color-hairline)]">
                  <Bot className="size-4 text-ink-soft" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{AGENT_NAME[r.agent] ?? r.agent}</span>
                  <span className="block truncate text-[13px] text-ink-soft">{r.summary ?? r.trigger}</span>
                </span>
                <span className="shrink-0 text-right text-[12px] text-ink-faint">
                  {r.status === "failed" ? <span className="block text-blocked">Failed</span> : null}
                  {new Date(r.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  {r.inputTokens + r.outputTokens ? <span className="block">{(r.inputTokens + r.outputTokens).toLocaleString()} tokens</span> : null}
                </span>
              </summary>
              <ol className="flex flex-col gap-4 bg-page/60 px-6 py-5 sm:pl-[76px]">
                {r.steps.map((s) => {
                  const { label, icon: Icon } = STEP[s.kind];
                  return (
                    <li key={s.id} className="flex flex-col gap-1.5 text-sm">
                      <span className="flex items-center gap-2">
                        <Icon className="size-3.5 text-ink-faint" strokeWidth={2} />
                        <span className="font-medium">{label}</span>
                        <span className="text-ink-soft">{s.name.replaceAll("_", " ")}</span>
                        {s.ms ? <span className="text-[12px] text-ink-faint">{s.ms} ms</span> : null}
                      </span>
                      <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-surface p-3 text-[12px] leading-relaxed text-ink-soft shadow-[inset_0_0_0_1px_var(--color-hairline)]">
                        {JSON.stringify(s.output, null, 1)}
                      </pre>
                    </li>
                  );
                })}
              </ol>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}
