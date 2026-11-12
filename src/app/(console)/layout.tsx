import { Suspense } from "react";
import { and, eq, sql } from "drizzle-orm";
import { AskKaffa } from "@/components/ask-kaffa";
import { Sidebar, SidebarSkeleton } from "@/components/sidebar";
import { approvals, intakeRows } from "@/db/schema";
import { consoleContext } from "@/lib/console";
import { integrationStatus } from "@/services/deps";

async function SidebarWithCounts() {
  const { db, orgId } = await consoleContext();
  const [[a], [i]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(and(eq(approvals.orgId, orgId), eq(approvals.status, "pending"))),
    db.select({ n: sql<number>`count(*)::int` }).from(intakeRows).where(and(eq(intakeRows.orgId, orgId), eq(intakeRows.status, "pending"))),
  ]);
  return <Sidebar counts={{ approvals: a.n, intake: i.n }} sources={integrationStatus()} />;
}

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-screen">
      <Suspense fallback={<SidebarSkeleton />}>
        <SidebarWithCounts />
      </Suspense>
      <main className="mx-auto w-full max-w-[1240px] px-4 pt-6 pb-16 sm:px-8 lg:pt-12 lg:pr-12 lg:pl-[120px]">{children}</main>
      <AskKaffa />
    </div>
  );
}
