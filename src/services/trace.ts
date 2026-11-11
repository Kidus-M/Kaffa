/**
 * Agent traces: every agent run records its steps (model calls, tool calls, rule
 * evaluations) so the console can show exactly what an agent did and why.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, agentSteps } from "@/db/schema";

export type Trace = {
  runId: string;
  step(kind: "model" | "tool" | "rule" | "note", name: string, input: unknown, output: unknown, ms?: number): Promise<void>;
  addUsage(usage: { inputTokens: number; outputTokens: number }): void;
  finish(status: "succeeded" | "failed", summary: string): Promise<void>;
};

export async function startTrace(db: Db, input: { orgId: string; agent: string; trigger: string }): Promise<Trace> {
  const [run] = await db.insert(agentRuns).values(input).returning({ id: agentRuns.id });
  let idx = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  return {
    runId: run.id,
    async step(kind, name, stepInput, output, ms = 0) {
      await db.insert(agentSteps).values({ runId: run.id, idx: idx++, kind, name, input: stepInput ?? null, output: output ?? null, ms });
    },
    addUsage(u) {
      inputTokens += u.inputTokens;
      outputTokens += u.outputTokens;
    },
    async finish(status, summary) {
      await db
        .update(agentRuns)
        .set({ status, summary, inputTokens, outputTokens, finishedAt: new Date().toISOString() })
        .where(eq(agentRuns.id, run.id));
    },
  };
}

/** Times an async call so trace steps carry real durations. */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - t0)];
}
