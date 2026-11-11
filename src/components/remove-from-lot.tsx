"use client";

import { useActionState, useId } from "react";
import { removeFromLot, type ActionState } from "@/app/(console)/actions";

export function RemoveFromLot({ plotRef, lotRef }: { plotRef: string; lotRef: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(removeFromLot, null);
  const id = useId();
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-blocked/40 bg-sheet p-4">
      <input type="hidden" name="plotRef" value={plotRef} />
      <label htmlFor={id} className="font-medium">
        Remove this plot from lot {lotRef}
      </label>
      <p className="text-sm text-ink-soft">
        Its coffee will not ship in this lot, so the rest of the lot can. Your reason is written to the ledger and shown to the buyer.
      </p>
      <textarea
        id={id}
        name="reason"
        required
        minLength={12}
        rows={3}
        className="rounded-md border border-rule bg-white p-2.5 text-sm"
        placeholder="For example: loss confirmed in 2023 imagery; this farm's coffee is sold outside the EU."
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-blocked px-4 py-2 text-sm font-semibold text-white hover:bg-ink disabled:opacity-60">
          {pending ? "Removing…" : "Remove from lot"}
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${state?.ok === false ? "text-blocked" : "text-ink-soft"}`}>
          {state?.message}
        </p>
      </div>
    </form>
  );
}
