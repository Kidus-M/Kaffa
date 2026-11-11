/**
 * One Drizzle schema, two drivers: Neon serverless in production (when DATABASE_URL
 * is set), PGlite locally so the app runs with zero setup.
 */
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

/** PGlite database; in memory when no directory is given (tests). Migrations run on open. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const db = drizzle({ client: new PGlite(dataDir), schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function createNeonDb(url: string): Promise<Db> {
  const { Pool } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  return drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as Db;
}

let shared: Promise<Db> | undefined;

/** The app's database. Neon migrations run from `npm run db:migrate`, not on request. */
export function getDb(): Promise<Db> {
  shared ??= process.env.DATABASE_URL
    ? createNeonDb(process.env.DATABASE_URL)
    : createPgliteDb(path.join(process.cwd(), ".data", "pglite"));
  return shared;
}

export { schema };
