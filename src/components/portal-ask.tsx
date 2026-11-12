"use client";

import { useActionState } from "react";
import { askPortalQuestion, type PortalAskState } from "@/app/portal/actions";
import { buttonClass } from "./ui";

export function PortalAsk({ token }: { token: string }) {
  const [state, action, pending] = useActionState<PortalAskState, FormData>(askPortalQuestion, null);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="token" value={token} />
        <label htmlFor="portal-question" className="sr-only">
          Your question
        </label>
        <input
          id="portal-question"
          name="question"
          maxLength={500}
          placeholder="For example: how long are the due diligence records kept?"
          className="h-10 min-w-0 flex-1 rounded-full bg-page px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] placeholder:text-ink-faint"
        />
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm") + " h-10"}>
          {pending ? "Checking the evidence" : "Ask"}
        </button>
      </form>
      {state && !state.ok ? <p className="text-sm text-blocked">{state.message}</p> : null}
      {state?.ok ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-page p-4">
          <p className="text-[13px] text-ink-faint">{state.question}</p>
          {state.status === "answered" ? (
            <p className="text-sm text-clear">Answered with {state.citations.length} cited source{state.citations.length === 1 ? "" : "s"}; it is the first answer below.</p>
          ) : (
            <p className="text-sm">
              {state.status === "drafted"
                ? "The exporter reviews answers before they are published here; you will see it below once approved."
                : "The stored evidence and the regulation don't answer this, so it has gone to the exporter, who will answer here."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
