"use client";

/**
 * Floating sidebar: an icon rail that expands over the page on hover or keyboard focus,
 * built as a stack of cards (navigation, data sources, organisation). On small screens
 * it becomes a top bar with a drawer.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Activity, ChevronDown, FileUp, Inbox, LayoutGrid, Map, Menu, Network, RotateCcw, Satellite, Ship, SlidersHorizontal, Users, X } from "lucide-react";
import { resetDemo } from "@/app/(console)/actions";

type Counts = { approvals: number; intake: number } | null;
type Sources = Record<"satellite" | "gemini" | "telegram" | "workflows" | "database" | "roads" | "weather" | "inbox" | "outbound", string>;

const NAV: { href: string; label: string; icon: ComponentType<{ className?: string; strokeWidth?: number }>; count?: "approvals" | "intake" }[] = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/shipments", label: "Shipments", icon: Ship },
  { href: "/plots", label: "Plots", icon: Map },
  { href: "/supply-chain", label: "Supply chain", icon: Network },
  { href: "/intake", label: "Intake", icon: FileUp, count: "intake" },
  { href: "/field-agents", label: "Field agents", icon: Users },
  { href: "/approvals", label: "Approvals", icon: Inbox, count: "approvals" },
  { href: "/activity", label: "Agent activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

const SOURCE_LABEL: Record<keyof Sources, string> = {
  satellite: "Satellite data",
  gemini: "Gemini",
  telegram: "Telegram",
  workflows: "Workflows",
  database: "Database",
  roads: "Road times",
  weather: "Weather",
  inbox: "Buyer inbox",
  outbound: "Outbound email",
};
const LIVE = new Set(["live", "durable", "neon", "open-meteo"]);

function KaffaMark({ className = "size-[18px] shrink-0" }: { className?: string }) {
  // A coffee bean: an oval split by a curved seam.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <ellipse cx="12" cy="12" rx="7.2" ry="9.6" transform="rotate(-28 12 12)" fill="currentColor" />
      <path d="M8.6 18.6c3.6-2.4 1.2-6.8 4.8-10.4 1.1-1.1 2.2-1.6 3.1-1.8" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavItems({ expanded, counts, onNavigate }: { expanded: boolean; counts: Counts; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon, count }) => {
        const active = isActive(pathname, href);
        const n = count && counts ? counts[count] : 0;
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-9 items-center gap-3 rounded-[18px] px-[9px] text-[14px] transition-colors ${
                active ? "bg-leaf-wash text-leaf-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"
              }`}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
              <span className={`whitespace-nowrap transition-opacity duration-150 ${expanded ? "opacity-100" : "opacity-0"}`}>{label}</span>
              {n > 0 ? (
                expanded ? (
                  <span className="ml-auto min-w-5 rounded-full bg-ink px-1.5 text-center text-[11px] leading-5 font-semibold text-white tabular-nums">{n}</span>
                ) : (
                  <span className="absolute top-1.5 left-[22px] size-2 rounded-full bg-blocked ring-2 ring-surface" aria-hidden />
                )
              ) : null}
              {n > 0 ? <span className="sr-only">, {n} waiting</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SourcesCard({ expanded, sources }: { expanded: boolean; sources: Sources }) {
  const [open, setOpen] = useState(false);
  const simulated = Object.values(sources).filter((v) => !LIVE.has(v)).length;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open && expanded}
        className="flex h-9 w-full items-center gap-3 rounded-[18px] px-[9px] text-left text-[14px] text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
      >
        <span className="relative shrink-0">
          <Satellite className="size-[18px]" strokeWidth={1.75} />
          <span className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-surface ${simulated ? "bg-review" : "bg-clear"}`} aria-hidden />
        </span>
        <span className={`flex-1 whitespace-nowrap transition-opacity duration-150 ${expanded ? "opacity-100" : "opacity-0"}`}>
          {simulated ? `Demo data, ${simulated} simulated` : "All sources live"}
        </span>
        <ChevronDown className={`size-4 shrink-0 transition-[transform,opacity] ${open ? "rotate-180" : ""} ${expanded ? "opacity-100" : "opacity-0"}`} />
      </button>
      {open && expanded ? (
        <div className="flex flex-col gap-2 px-[9px] pt-1 pb-2">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
            {(Object.keys(SOURCE_LABEL) as (keyof Sources)[]).map((k) => (
              <div key={k} className="contents">
                <dt className="text-ink-soft">{SOURCE_LABEL[k]}</dt>
                <dd className={LIVE.has(sources[k]) ? "text-clear" : "text-review"}>{sources[k]}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[12px] leading-snug text-ink-faint">Farms, cooperatives and buyers are synthetic. Plots sit at real locations.</p>
          <form
            action={resetDemo}
            onSubmit={(e) => {
              if (!confirm("Reset the synthetic demo data? Every change made in this demo is lost.")) e.preventDefault();
            }}
          >
            <button type="submit" className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink">
              <RotateCcw className="size-3.5" /> Reset demo data
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function OrgRow({ expanded }: { expanded: boolean }) {
  return (
    <div className="flex h-9 items-center gap-3 px-[5px]">
      <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-leaf text-[12px] font-semibold text-white">S</span>
      <span className={`flex min-w-0 flex-col leading-tight transition-opacity duration-150 ${expanded ? "opacity-100" : "opacity-0"}`}>
        <span className="truncate text-[13px] font-medium text-ink">Sidama Highland</span>
        <span className="truncate text-[12px] text-ink-faint">Exporter, synthetic</span>
      </span>
    </div>
  );
}

const CARD = "overflow-hidden rounded-[var(--radius-shell)] bg-surface/95 p-1.5 shadow-[var(--shadow-float)] backdrop-blur";

export function Sidebar({ counts, sources }: { counts: Counts; sources: Sources }) {
  const [expanded, setExpanded] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
        setDrawer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const width = expanded ? "w-[232px]" : "w-12";

  return (
    <>
      {/* Desktop: floating rail that expands over the page. */}
      <div
        ref={root}
        className="fixed top-6 left-6 z-40 hidden flex-col gap-2 lg:flex"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={(e) => {
          if (!root.current?.contains(e.relatedTarget as Node)) setExpanded(false);
        }}
      >
        <nav aria-label="Main" className={`${CARD} ${width} transition-[width] duration-200 ease-out`}>
          <Link href="/" className="mb-1 flex h-9 items-center gap-3 rounded-[18px] px-[9px] text-leaf">
            <KaffaMark />
            <span className={`flex items-baseline gap-1.5 whitespace-nowrap transition-opacity duration-150 ${expanded ? "opacity-100" : "opacity-0"}`}>
              <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Kaffa</span>
              <span lang="am" className="font-amharic text-[13px] text-ink-faint">ከፋ</span>
            </span>
          </Link>
          <NavItems expanded={expanded} counts={counts} />
        </nav>
        <div className={`${CARD} ${width} transition-[width] duration-200 ease-out`}>
          <SourcesCard expanded={expanded} sources={sources} />
        </div>
        <div className={`${CARD} ${width} transition-[width] duration-200 ease-out`}>
          <OrgRow expanded={expanded} />
        </div>
      </div>

      {/* Small screens: top bar and drawer. */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-hairline bg-page/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2 text-leaf">
          <KaffaMark className="size-5" />
          <span className="text-[16px] font-semibold text-ink">Kaffa</span>
        </Link>
        <button type="button" onClick={() => setDrawer(true)} className="grid size-10 place-items-center rounded-full bg-surface shadow-[var(--shadow-card)]" aria-label="Open navigation">
          <Menu className="size-5" />
        </button>
      </div>
      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-ink/20" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          <div className="absolute top-3 right-3 left-3 flex flex-col gap-2">
            <nav aria-label="Main" className={CARD}>
              <div className="mb-1 flex h-10 items-center justify-between px-[9px]">
                <span className="flex items-center gap-2 text-leaf">
                  <KaffaMark />
                  <span className="text-[15px] font-semibold text-ink">Kaffa</span>
                </span>
                <button type="button" onClick={() => setDrawer(false)} className="grid size-8 place-items-center rounded-full hover:bg-sunken" aria-label="Close navigation">
                  <X className="size-4" />
                </button>
              </div>
              <NavItems expanded counts={counts} onNavigate={() => setDrawer(false)} key={pathname} />
            </nav>
            <div className={CARD}>
              <SourcesCard expanded sources={sources} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Static placeholder while the sidebar's counts stream in: same shape, no URL access, so it never blocks prerendering. */
export function SidebarSkeleton() {
  return (
    <div className="fixed top-6 left-6 z-40 hidden flex-col gap-2 lg:flex" aria-hidden>
      <div className={`${CARD} w-12`}>
        <div className="mb-1 flex h-9 items-center px-[9px] text-leaf">
          <KaffaMark />
        </div>
        <div className="flex flex-col gap-1">
          {NAV.map(({ href, icon: Icon }) => (
            <span key={href} className="flex h-9 items-center px-[9px] text-ink-soft">
              <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
