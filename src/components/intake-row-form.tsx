"use client";

import { useActionState } from "react";
import { resolveIntake, type ActionState } from "@/app/(console)/actions";
import { buttonClass } from "./ui";

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
    <form action={action} className="flex flex-col gap-4 p-6">
      <input type="hidden" name="rowId" value={rowId} />
      <p className="text-[13px] text-ink-faint">From {fileName}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {ORDER.map((k) => {
          const f = data[k];
          const flagged = reviewFields.includes(k);
          return (
            <label key={k} className="flex flex-col gap-1.5 text-[13px]">
              <span className={flagged ? "font-medium text-review" : "text-ink-faint"}>
                {LABEL[k]}
                {flagged ? (f?.value === null || f?.value === "" ? ", missing" : `, ${Math.round((f?.confidence ?? 0) * 100)}% sure`) : null}
              </span>
              <input
                name={k}
                defaultValue={f?.value ?? ""}
                inputMode={k === "areaHa" || k === "lat" || k === "lon" ? "decimal" : undefined}
                className={`h-10 rounded-[var(--radius-control)] px-3 text-sm ${
                  flagged ? "bg-review-wash shadow-[inset_0_0_0_1.5px_var(--color-review)]" : "bg-page shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]"
                }`}
              />
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button name="decision" value="accept" disabled={pending} className={buttonClass("primary", "sm")}>
          Add as plot
        </button>
        <button name="decision" value="reject" disabled={pending} className={buttonClass("secondary", "sm")}>
          Reject row
        </button>
        <p role="status" aria-live="polite" className={`ml-1 text-[13px] ${state?.ok === false ? "text-blocked" : "text-ink-soft"}`}>
          {state?.message}
        </p>
      </div>
    </form>
  );
}
