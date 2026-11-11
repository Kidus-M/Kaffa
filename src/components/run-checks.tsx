"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { runChecksAction, type ActionState } from "@/app/(console)/actions";
import { buttonClass } from "./ui";

export function RunChecks() {
  const [state, action, pending] = useActionState<ActionState, FormData>(runChecksAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-1.5 sm:items-end">
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} strokeWidth={2} />
        {pending ? "Running checks" : "Run today's checks"}
      </button>
      <p role="status" aria-live="polite" className="max-w-80 text-[13px] text-ink-soft sm:text-right">
        {state?.message ?? "Screens every plot and chases field agents, like the 6:00 daily run."}
      </p>
    </form>
  );
}
