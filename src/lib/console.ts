import "server-only";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { orgs } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { seedDemo } from "@/db/seed";

/**
 * The console's database and organisation. Tier 1 serves the single synthetic demo
 * organisation; sign-in and roles arrive in Tier 2. A fresh local database seeds itself,
 * so a reviewer sees a working product on first run.
 */
export async function consoleContext() {
  await connection();
  const db = await getDb();
  const existing = await db.select({ id: orgs.id }).from(orgs).limit(1);
  if (!existing.length) await seedDemo(db);
  return { db, orgId: DEMO_ORG_ID };
}
