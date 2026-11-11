import Link from "next/link";
import { Suspense } from "react";
import { integrationStatus } from "@/services/deps";
import { resetDemo } from "./actions";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/plots", label: "Plots" },
  { href: "/intake", label: "Intake" },
  { href: "/field-agents", label: "Field agents" },
  { href: "/approvals", label: "Approvals" },
  { href: "/activity", label: "Agent activity" },
] as const;

const MODE_TEXT: Record<string, string> = {
  live: "live",
  simulated: "simulated",
  templates: "templates only",
  off: "not connected",
  durable: "durable",
  inline: "inline",
  neon: "Neon",
  local: "local",
};

function IntegrationStrip() {
  const s = integrationStatus();
  const items = [
    ["Satellite data", s.satellite],
    ["Gemini", s.gemini],
    ["Telegram", s.telegram],
    ["Workflows", s.workflows],
    ["Database", s.database],
  ] as const;
  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs text-ink-soft">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{k}</dt>
          <dd className={v === "simulated" || v === "off" || v === "templates" ? "text-review" : "text-ink"}>{MODE_TEXT[v]}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col lg:flex-row">
      <aside className="border-rule flex shrink-0 flex-col gap-6 border-b px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-r lg:border-b-0 lg:px-6 lg:py-8">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-canopy">Kaffa</span>
          <span lang="am" className="font-amharic text-lg text-ink-soft">ከፋ</span>
        </Link>
        <nav aria-label="Console">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:flex-col lg:gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="block rounded py-1 text-[15px] text-ink hover:text-canopy lg:py-1.5">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto hidden flex-col gap-4 lg:flex">
          <Suspense>
            <IntegrationStrip />
          </Suspense>
          <p className="text-xs leading-relaxed text-ink-soft">
            Synthetic demo: farms, cooperatives and buyers are invented. Plots sit at real locations.
          </p>
          <form action={resetDemo}>
            <button type="submit" className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
              Reset demo data
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-12 lg:py-10">{children}</main>
    </div>
  );
}
