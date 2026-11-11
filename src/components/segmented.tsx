import Link from "next/link";

/** A pill-shaped switch between views. Each option is a link, so it works without JavaScript. */
export function Segmented({ options, value, label }: { options: { value: string; label: string; href: string }[]; value: string; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex rounded-full bg-sunken p-1 shadow-[inset_0_0_0_1px_var(--color-hairline)]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-ink-soft hover:text-ink"}`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
