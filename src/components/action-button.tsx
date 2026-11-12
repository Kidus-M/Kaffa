"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/app/(console)/actions";
import { buttonClass } from "./ui";

/** A one-click server action with its result shown beside the button. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  hint,
  icon,
  variant = "secondary",
  align = "start",
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel: string;
  hint?: string;
  icon?: ReactNode;
  variant?: "primary" | "secondary";
  align?: "start" | "end";
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className={`flex flex-col gap-1.5 ${align === "end" ? "items-start sm:items-end" : "items-start"}`}>
      <button type="submit" disabled={pending} className={buttonClass(variant, "sm")}>
        {icon}
        {pending ? pendingLabel : label}
      </button>
      {state?.message || hint ? (
        <p role="status" aria-live="polite" className={`max-w-80 text-[13px] ${align === "end" ? "sm:text-right" : ""} ${state?.ok === false ? "text-blocked" : "text-ink-soft"}`}>
          {state?.message ?? hint}
        </p>
      ) : null}
    </form>
  );
}
