"use client";

import { useActionState } from "react";
import { resolveIntake, type ActionState } from "@/app/(console)/actions";

type Field = { value: string | number | null; confidence: number };
const LABEL: Record<string, string> = {
  farmerName: "Farmer",
  village: "Village",
  phone: "Phone",
  areaHa: "Area (ha)",
  lat: "Latitude",
  lon: "Longitude",
};
const ORDER = ["farmerName", "village", "phone", "areaHa", "lat", "lon"] as const;

/** One uncertain register row. Fields the agent was unsure about are highlighted with its confidence. */
export function IntakeRowForm({ rowId, data, reviewFields, fileName }: { rowId: string; data: Record<string, Field>; reviewFields: string[]; fileName: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resolveIntake, null);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-4">
      <input type="hidden" name="rowId" value={rowId} />
      <p className="text-sm text-ink-soft">From {fileName}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {ORDER.map((k) => {
          const f = data[k];
          const flagged = reviewFields.includes(k);
          return (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span className={flagged ? "font-medium text-review" : "text-ink-soft"}>
                {LABEL[k]}
                {flagged ? (f?.value === null || f?.value === "" ? ", missing" : `, ${Math.round((f?.confidence ?? 0) * 100)}% sure`) : null}
              </span>
              <input
                name={k}
                defaultValue={f?.value ?? ""}
                inputMode={k === "areaHa" || k === "lat" || k === "lon" ? "decimal" : undefined}
                className={`rounded-md border bg-white p-2 ${flagged ? "border-review" : "border-rule"}`}
              />
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button name="decision" value="accept" disabled={pending} className="rounded-md bg-canopy px-4 py-2 text-sm font-semibold text-white hover:bg-ink disabled:opacity-60">
          Add as plot
        </button>
        <button name="decision" value="reject" disabled={pending} className="rounded-md border border-rule px-4 py-2 text-sm font-semibold hover:bg-white disabled:opacity-60">
          Reject row
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${state?.ok === false ? "text-blocked" : "text-ink-soft"}`}>
          {state?.message}
        </p>
      </div>
    </form>
  );
}
