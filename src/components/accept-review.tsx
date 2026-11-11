"use client";

import { useActionState, useId } from "react";
import { acceptReview, type ActionState } from "@/app/(console)/actions";

export function AcceptReview({ plotRef }: { plotRef: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(acceptReview, null);
  const id = useId();
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-review/40 bg-sheet p-4">
      <input type="hidden" name="plotRef" value={plotRef} />
      <label htmlFor={id} className="font-medium">
        Accept this plot after review
      </label>
      <p className="text-sm text-ink-soft">
        Only accept when you have evidence, such as a field photo showing shade-grown coffee. Your reason is written to the ledger.
      </p>
      <textarea
        id={id}
        name="reason"
        required
        minLength={12}
        rows={3}
        className="rounded-md border border-rule bg-white p-2.5 text-sm"
        placeholder="For example: field photo shows mature shade trees over coffee; the loss is a single fallen tree."
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-canopy px-4 py-2 text-sm font-semibold text-white hover:bg-ink disabled:opacity-60">
          {pending ? "Accepting…" : "Accept plot"}
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${state?.ok === false ? "text-blocked" : "text-ink-soft"}`}>
          {state?.message}
        </p>
      </div>
    </form>
  );
}
