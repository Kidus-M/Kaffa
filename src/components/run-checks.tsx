"use client";

import { useActionState } from "react";
import { runChecksAction, type ActionState } from "@/app/(console)/actions";

export function RunChecks() {
  const [state, action, pending] = useActionState<ActionState, FormData>(runChecksAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-canopy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink disabled:opacity-60"
      >
        {pending ? "Running checks…" : "Run today's checks"}
      </button>
      <p role="status" aria-live="polite" className="max-w-72 text-sm text-ink-soft sm:text-right">
        {state?.message ?? "Screens every plot and chases field agents, as the 6:00 daily run does."}
      </p>
    </form>
  );
}
