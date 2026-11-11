/**
 * Shared building blocks, so every page has the same rhythm: one page header,
 * cards on hairline edges, and buttons that say what they do.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        {back ? (
          <Link href={back.href} className="w-fit text-sm text-ink-soft transition-colors hover:text-ink">
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-[clamp(1.9rem,3.6vw,2.6rem)] leading-[1.08] font-light tracking-[-0.025em] text-ink">{title}</h1>
        {description ? <p className="max-w-2xl text-[15px] leading-relaxed text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ className = "", children, as: Tag = "section", ...rest }: { as?: "section" | "article" | "div" | "li" } & Omit<ComponentProps<"section">, "ref">) {
  return (
    <Tag className={`rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, meta, id }: { title: ReactNode; meta?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-6">
      <h2 id={id} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {meta ? <div className="text-sm text-ink-soft">{meta}</div> : null}
    </div>
  );
}

const BUTTON = {
  primary: "bg-ink text-white hover:bg-leaf-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]",
  secondary: "bg-surface text-ink shadow-[var(--shadow-card)] hover:bg-sunken",
  danger: "bg-blocked text-white hover:bg-[#a92539]",
  ghost: "text-ink-soft hover:bg-sunken hover:text-ink",
} as const;

export function buttonClass(variant: keyof typeof BUTTON = "primary", size: "md" | "sm" = "md") {
  const sizing = size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm";
  return `inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${sizing} ${BUTTON[variant]}`;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[var(--radius-card)] border border-dashed border-hairline-strong px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? <p className="max-w-md text-sm text-ink-soft">{children}</p> : null}
    </div>
  );
}

/** A labelled fact: label above value, used in side panels. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-ink-faint">{label}</dt>
      <dd className="text-[15px] text-ink">{children}</dd>
    </div>
  );
}
