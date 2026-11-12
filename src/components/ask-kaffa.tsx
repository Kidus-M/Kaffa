"use client";

/**
 * Ask Kaffa: a panel on every console screen. Questions are answered from the exporter's
 * evidence and the regulation, and every sentence links to the source it relies on.
 */
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { MessageCircleQuestion, X } from "lucide-react";
import { askKaffa, type AskState } from "@/app/(console)/actions";
import { buttonClass } from "./ui";

const SUGGESTIONS = ["Why is the Antwerp shipment at risk?", "Do plots above four hectares need a polygon?", "How long must we keep due diligence records?"];

export function AskKaffa() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AskState, FormData>(askKaffa, null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed right-6 bottom-6 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-white shadow-[var(--shadow-float)] transition-colors hover:bg-leaf-ink ${open ? "hidden" : ""}`}
      >
        <MessageCircleQuestion className="size-4" /> Ask Kaffa
      </button>
      {open ? (
        <div role="dialog" aria-label="Ask Kaffa" className="fixed inset-x-3 bottom-3 z-50 flex max-h-[80vh] flex-col overflow-hidden rounded-[var(--radius-shell)] bg-surface shadow-[var(--shadow-float)] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[420px]">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-[15px] font-semibold">Ask Kaffa</h2>
            <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-full hover:bg-sunken" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-3">
            {state && "answer" in state ? (
              <div className="flex flex-col gap-3 py-2">
                <p className="text-[13px] text-ink-faint">{state.question}</p>
                <AnswerText text={state.answer.supported ? state.answer.answer : state.answer.answer} />
                {state.answer.citations.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {state.answer.citations.map((c) => (
                      <li key={c.id}>
                        {c.href ? (
                          <Link href={c.href} onClick={() => setOpen(false)} className="inline-block rounded-full bg-leaf-wash px-2.5 py-1 text-[12px] text-leaf-ink hover:underline">
                            {c.label}
                          </Link>
                        ) : (
                          <span className="inline-block rounded-full bg-sunken px-2.5 py-1 text-[12px] text-ink-soft">{c.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-[11px] text-ink-faint">
                  {state.answer.mode === "gemini" ? "Written by Gemini from the sources shown" : "Quoted from the sources shown, without AI"}. Regulation passages are summaries; the Official Journal text governs.
                </p>
              </div>
            ) : state && "error" in state ? (
              <p className="py-2 text-sm text-blocked">{state.error}</p>
            ) : (
              <ul className="flex flex-col gap-1.5 py-2">
                {SUGGESTIONS.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => {
                        if (input.current) input.current.value = s;
                        input.current?.form?.requestSubmit();
                      }}
                      className="w-full rounded-[var(--radius-control)] bg-page px-3 py-2 text-left text-sm text-ink-soft hover:text-ink"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form action={action} className="flex gap-2 border-t border-hairline p-3">
            <label htmlFor="ask-kaffa" className="sr-only">
              Your question
            </label>
            <input
              ref={input}
              id="ask-kaffa"
              name="question"
              maxLength={500}
              placeholder="Ask about a shipment, a lot or the rules"
              className="h-10 min-w-0 flex-1 rounded-full bg-page px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] placeholder:text-ink-faint"
            />
            <button type="submit" disabled={pending} className={buttonClass("primary", "sm") + " h-10"}>
              {pending ? "Thinking" : "Ask"}
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}

/** Renders [source] markers as small superscript references. */
export function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\[[A-Za-z0-9-]+\])/g);
  return (
    <p className="text-[15px] leading-relaxed">
      {parts.map((p, i) =>
        /^\[[A-Za-z0-9-]+\]$/.test(p) ? (
          <sup key={i} className="ml-0.5 text-[10px] text-leaf">
            {p.slice(1, -1)}
          </sup>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}
