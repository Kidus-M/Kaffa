import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui";
import { getDb } from "@/db/client";
import { loadChain } from "@/db/events";
import { checks, flags, gaps, lotPlots, lots, plots, shipments } from "@/db/schema";
import { dayMonth } from "@/lib/queries";

export const metadata = { title: "Verify a lot", robots: { index: false } };

/**
 * The public page behind each lot's QR code. Read-only: what the lot is, how its plots
 * stand, and whether the evidence ledger still verifies, recomputed on every visit.
 * Farmer names, coordinates and buyer details are not shown.
 */
export default function VerifyPage({ params }: PageProps<"/verify/[code]">) {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6 px-4 py-12 sm:py-16">
      <Suspense fallback={<div className="h-80 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
        <Verify params={params} />
      </Suspense>
    </div>
  );
}

async function Verify({ params }: { params: PageProps<"/verify/[code]">["params"] }) {
  await connection();
  const { code } = await params;
  if (!/^[a-f0-9]{12}$/.test(code)) notFound();
  const db = await getDb();
  const [lot] = await db.select().from(lots).where(eq(lots.publicCode, code));
  if (!lot) notFound();
  const [ship] = lot.shipmentId ? await db.select({ port: shipments.destinationPort, date: shipments.shipDate }).from(shipments).where(eq(shipments.id, lot.shipmentId)) : [];
  const members = await db
    .select({ id: plots.id, status: plots.status, reviewAccepted: plots.reviewAccepted })
    .from(lotPlots)
    .innerJoin(plots, eq(plots.id, lotPlots.plotId))
    .where(eq(lotPlots.lotId, lot.id));
  const [latest] = members.length
    ? await db.select({ rulesVersion: checks.rulesVersion, at: checks.createdAt, simulated: checks.simulated }).from(checks).where(and(inArray(checks.plotId, members.map((m) => m.id)))).orderBy(desc(checks.createdAt)).limit(1)
    : [];
  const openRequests = members.length
    ? (await db.select({ id: gaps.id }).from(gaps).where(and(inArray(gaps.plotId, members.map((m) => m.id)), eq(gaps.status, "open")))).length
    : 0;
  const openFlags = (await db.select({ id: flags.id }).from(flags).where(and(eq(flags.lotId, lot.id), eq(flags.status, "open")))).length;
  const holds = [
    openRequests ? `${openRequests} field request${openRequests > 1 ? "s are" : " is"} still open, such as a boundary to re-walk` : "",
    openFlags ? `${openFlags} supply chain flag${openFlags > 1 ? "s" : ""} on delivered volumes ${openFlags > 1 ? "are" : "is"} unresolved` : "",
  ].filter(Boolean);
  const { entries, verification } = await loadChain(db, lot.orgId);
  const clear = members.filter((m) => m.status === "clear" || (m.status === "review" && m.reviewAccepted)).length;

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-sm text-ink-soft">Kaffa lot verification{lot.synthetic ? " · synthetic demo data" : ""}</p>
        <h1 className="text-[clamp(2rem,5vw,2.8rem)] leading-[1.05] font-light tracking-[-0.03em]">{lot.ref}</h1>
        <p className="text-[15px] text-ink-soft">
          {lot.grade}, {(lot.quantityKg / 1000).toFixed(1)} t{ship ? `, shipping to ${ship.port} in ${dayMonth(ship.date).split(" ")[1]}` : ""}.
        </p>
      </header>
      <Card className="flex flex-col gap-5 p-6">
        <Row ok={lot.state === "ready"} title={lot.state === "ready" ? "Ready to ship" : "Held by the exporter"}>
          {clear} of {members.length} farm plots are clear of tree cover loss after 31 December 2020, or were reviewed and accepted with a recorded reason.
          {lot.state !== "ready" && holds.length ? ` Held because ${holds.join(", and ")}.` : ""}
        </Row>
        <Row ok={verification.ok} title={verification.ok ? "Evidence ledger verifies" : "Evidence ledger does not verify"}>
          Recomputed just now over {entries.length} hash-chained entries. Latest hash <code className="break-all text-[12px]">{verification.ok ? verification.head.slice(0, 24) : "n/a"}</code>, the same hash printed on the exporter&apos;s data sheets.
        </Row>
        {latest ? (
          <p className="text-[13px] text-ink-faint">
            Last satellite check {new Date(latest.at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} under rules {latest.rulesVersion}
            {latest.simulated ? ", using simulated satellite data" : ""}.
          </p>
        ) : null}
      </Card>
      <p className="text-[13px] leading-relaxed text-ink-faint">
        Statuses come from fixed rules over Global Forest Watch data, never from an AI model. This page supports a buyer&apos;s due diligence; it is not a legal determination of compliance.
      </p>
    </>
  );
}

function Row({ ok, title, children }: { ok: boolean; title: string; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="flex gap-3">
      <Icon className={`mt-0.5 size-5 shrink-0 ${ok ? "text-clear" : "text-review"}`} strokeWidth={1.75} />
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-medium">{title}</p>
        <p className="text-sm leading-relaxed text-ink-soft">{children}</p>
      </div>
    </div>
  );
}
