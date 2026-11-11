import Link from "next/link";
import { Suspense } from "react";
import { and, desc, eq } from "drizzle-orm";
import { IntakeRowForm } from "@/components/intake-row-form";
import { IntakeUpload } from "@/components/intake-upload";
import { cooperatives, intakeBatches, intakeRows } from "@/db/schema";
import { consoleContext } from "@/lib/console";
import { integrationStatus } from "@/services/deps";

export const metadata = { title: "Intake" };

export default function IntakePage() {
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Intake</h1>
        <p className="mt-2 text-ink-soft">
          Upload a cooperative&apos;s register. Confident rows become plots and are checked against the same rules as every plot. Rows the intake agent is unsure about wait here for you.
        </p>
      </header>
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <IntakeBody />
      </Suspense>
    </div>
  );
}

async function IntakeBody() {
  const { db, orgId } = await consoleContext();
  const coops = await db.select({ id: cooperatives.id, name: cooperatives.name }).from(cooperatives).where(eq(cooperatives.orgId, orgId));
  const pending = await db
    .select({ row: intakeRows, fileName: intakeBatches.fileName })
    .from(intakeRows)
    .innerJoin(intakeBatches, eq(intakeBatches.id, intakeRows.batchId))
    .where(and(eq(intakeRows.orgId, orgId), eq(intakeRows.status, "pending")))
    .orderBy(desc(intakeRows.createdAt), intakeRows.idx);
  const batches = await db.select().from(intakeBatches).where(eq(intakeBatches.orgId, orgId)).orderBy(desc(intakeBatches.createdAt)).limit(8);
  const created = await db
    .select({ batchId: intakeRows.batchId, plotId: intakeRows.plotId })
    .from(intakeRows)
    .where(and(eq(intakeRows.orgId, orgId), eq(intakeRows.status, "accepted")));

  return (
    <>
      <IntakeUpload cooperatives={coops} photosEnabled={integrationStatus().gemini === "live"} />

      <section aria-labelledby="review" className="flex flex-col gap-3">
        <h2 id="review" className="text-xl font-semibold">Rows to check</h2>
        {pending.length === 0 ? (
          <p className="text-ink-soft">Nothing to check. Rows appear here when a value is missing or the intake agent is less than 80% sure of it.</p>
        ) : (
          pending.map(({ row, fileName }) => (
            <IntakeRowForm key={row.id} rowId={row.id} fileName={fileName} reviewFields={row.reviewFields} data={row.data as Record<string, { value: string | number | null; confidence: number }>} />
          ))
        )}
      </section>

      {batches.length ? (
        <section aria-labelledby="batches" className="flex flex-col gap-2">
          <h2 id="batches" className="text-xl font-semibold">Recent registers</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {batches.map((b) => (
              <li key={b.id}>
                <span className="font-medium">{b.fileName}</span>{" "}
                <span className="text-ink-soft">
                  {b.source === "photo" ? "photo, read by Gemini" : "spreadsheet"}: {b.rowCount} rows, {b.createdCount} plots created, {b.reviewCount} sent for review.{" "}
                  {created.filter((c) => c.batchId === b.id).length ? <Link href="/plots" className="text-canopy underline underline-offset-2">See plots</Link> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
