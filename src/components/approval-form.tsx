"use client";

import { useActionState, useId } from "react";
import { decideApproval, type ActionState } from "@/app/(console)/actions";
import { buttonClass } from "./ui";

/** Approve or reject, with an optional note for the ledger (required where the note is the answer). */
export function ApprovalForm({ id, noteLabel, noteRequired = false }: { id: string; noteLabel?: string; noteRequired?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideApproval, null);
  const noteId = useId();
  if (state?.ok) {
    return (
      <p role="status" className="rounded-[var(--radius-control)] bg-leaf-wash px-4 py-3 text-sm text-leaf-ink">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={noteId} className="sr-only">
        {noteLabel ?? "Note for the ledger, optional"}
      </label>
      {noteRequired ? (
        <textarea
          id={noteId}
          name="reason"
          rows={3}
          placeholder={noteLabel}
          className="rounded-[var(--radius-control)] bg-page p-3 text-sm shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] placeholder:text-ink-faint focus:bg-surface"
        />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {!noteRequired ? (
          <input
            id={noteId}
            name="reason"
            placeholder="Note for the ledger (optional)"
            className="h-10 flex-1 rounded-full bg-page px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] placeholder:text-ink-faint"
          />
        ) : null}
        <div className="flex gap-2">
          <button name="decision" value="approved" disabled={pending} className={buttonClass("primary", "sm")}>
            {pending ? "Working" : "Approve"}
          </button>
          <button name="decision" value="rejected" disabled={pending} className={buttonClass("secondary", "sm")}>
            Reject
          </button>
        </div>
      </div>
      {state && !state.ok ? (
        <p role="status" className="text-[13px] text-blocked">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
