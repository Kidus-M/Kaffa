"use client";

import { useActionState, useId } from "react";
import type { ActionState } from "@/app/(console)/actions";
import { buttonClass } from "./ui";

/**
 * A decision that needs a written reason, which goes on the ledger.
 * Used for accepting a review plot and for removing a plot from its lot.
 */
export function ReasonForm({
  plotRef,
  action,
  title,
  help,
  placeholder,
  submit,
  pendingLabel,
  tone = "primary",
  field = "plotRef",
}: {
  plotRef: string;
  /** Name of the hidden field carrying the subject's id. */
  field?: string;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  title: string;
  help: string;
  placeholder: string;
  submit: string;
  pendingLabel: string;
  tone?: "primary" | "danger";
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const id = useId();
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name={field} value={plotRef} />
      <label htmlFor={id} className="text-[15px] font-medium">
        {title}
      </label>
      <p className="text-[13px] leading-relaxed text-ink-soft">{help}</p>
      <textarea
        id={id}
        name="reason"
        required
        minLength={12}
        rows={3}
        className="rounded-[var(--radius-control)] bg-page p-3 text-sm shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] placeholder:text-ink-faint focus:bg-surface"
        placeholder={placeholder}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass(tone, "sm")}>
          {pending ? pendingLabel : submit}
        </button>
        <p role="status" aria-live="polite" className={`text-[13px] ${state?.ok === false ? "text-blocked" : "text-ink-soft"}`}>
          {state?.message}
        </p>
      </div>
    </form>
  );
}
