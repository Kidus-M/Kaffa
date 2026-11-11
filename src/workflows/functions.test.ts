import { describe, expect, it } from "vitest";
import { runChase, type ChaseActions, type StepRunner } from "./chase-flow";
import { EVENTS } from "./events";

/** A fake step runner: runs steps inline and answers each wait from a script. */
function fakeStep(replies: Record<string, unknown>) {
  const log: string[] = [];
  const waits: { id: string; timeout: string; event: string; match: string }[] = [];
  const step: StepRunner = {
    run: async (id, fn) => {
      log.push(id);
      return fn();
    },
    waitForEvent: async (id, opts) => {
      log.push(id);
      waits.push({ id, ...opts });
      return replies[id] ?? null;
    },
  };
  return { step, log, waits };
}

const actions = (sent = true): ChaseActions & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    send: async (reminder) => {
      calls.push(reminder ? "reminder" : "chase");
      return sent ? { sent: true, plotRefs: ["KNG-011"], source: "template" } : { sent: false, reason: "not_registered" };
    },
    escalate: async (hours) => void calls.push(`escalate:${hours}`),
  };
};

const reply = { name: EVENTS.fieldReplied, data: { fieldAgentId: "fa_dawit" } };

describe("runChase", () => {
  it("stops when the field agent replies, waiting 48 hours matched on the field agent", async () => {
    const { step, waits } = fakeStep({ "wait-for-reply": reply });
    const a = actions();
    expect(await runChase(step, a)).toEqual({ outcome: "replied" });
    expect(a.calls).toEqual(["chase"]);
    expect(waits[0]).toMatchObject({ event: EVENTS.fieldReplied, timeout: "48h", match: "data.fieldAgentId" });
  });

  it("reminds after 48 hours, then stops on a late reply", async () => {
    const { step } = fakeStep({ "wait-after-reminder": reply });
    const a = actions();
    expect(await runChase(step, a)).toEqual({ outcome: "replied_after_reminder" });
    expect(a.calls).toEqual(["chase", "reminder"]);
  });

  it("escalates at 96 hours when nobody replies", async () => {
    const { step, log, waits } = fakeStep({});
    const a = actions();
    expect(await runChase(step, a)).toEqual({ outcome: "escalated" });
    expect(a.calls).toEqual(["chase", "reminder", "escalate:96"]);
    expect(log).toEqual(["send-chase", "wait-for-reply", "send-reminder", "wait-after-reminder", "escalate"]);
    expect(waits[1].timeout).toBe("48h");
  });

  it("does not wait when nothing could be sent", async () => {
    const { step, log } = fakeStep({});
    expect(await runChase(step, actions(false))).toEqual({ outcome: "not_sent", reason: "not_registered" });
    expect(log).toEqual(["send-chase"]);
  });
});
