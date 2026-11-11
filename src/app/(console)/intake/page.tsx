import Link from "next/link";
import { Suspense } from "react";
import { and, desc, eq } from "drizzle-orm";
import { IntakeRowForm } from "@/components/intake-row-form";
import { IntakeUpload } from "@/components/intake-upload";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { cooperatives, intakeBatches, intakeRows } from "@/db/schema";
import { consoleContext } from "@/lib/console";
import { integrationStatus } from "@/services/deps";

export const metadata = { title: "Intake" };

export default function IntakePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Intake"
        description="Upload a cooperative's register. Confident rows become plots and go through the same checks as every plot. Rows the intake agent is unsure about wait here for you."
      />
      <Suspense fallback={<div className="h-80 animate-pulse rounded-[var(--radius-card)] bg-sunken" />}>
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

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card className="p-6">
          <IntakeUpload cooperatives={coops} photosEnabled={integrationStatus().gemini === "live"} />
        </Card>
        <section aria-labelledby="review" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="review" className="text-[19px] font-medium tracking-[-0.015em]">Rows to check</h2>
            {pending.length ? <span className="text-sm text-ink-soft">{pending.length} waiting</span> : null}
          </div>
          {pending.length === 0 ? (
            <EmptyState title="Nothing to check">Rows appear here when a value is missing or the intake agent is less than 80% sure of it.</EmptyState>
          ) : (
            pending.map(({ row, fileName }) => (
              <Card key={row.id}>
                <IntakeRowForm rowId={row.id} fileName={fileName} reviewFields={row.reviewFields} data={row.data as Record<string, { value: string | number | null; confidence: number }>} />
              </Card>
            ))
          )}
        </section>
      </div>

      <Card aria-labelledby="batches" className="xl:sticky xl:top-12">
        <CardHeader id="batches" title="Recent registers" />
        {batches.length === 0 ? (
          <p className="px-6 pt-3 pb-6 text-sm text-ink-soft">No registers uploaded yet.</p>
        ) : (
          <ul className="flex flex-col px-3 pt-2 pb-3">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-col gap-0.5 rounded-[var(--radius-control)] px-3 py-2.5">
                <span className="truncate text-sm font-medium">{b.fileName}</span>
                <span className="text-[13px] text-ink-soft">
                  {b.source === "photo" ? "Photo, read by Gemini" : "Spreadsheet"}: {b.createdCount} of {b.rowCount} rows became plots
                  {b.reviewCount ? `, ${b.reviewCount} sent for review` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-hairline px-6 py-4">
          <Link href="/plots?view=table" className="text-[13px] font-medium text-ink hover:text-leaf">
            See all plots
          </Link>
        </div>
      </Card>
    </div>
  );
}
