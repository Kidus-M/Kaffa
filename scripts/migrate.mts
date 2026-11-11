/** Applies SQL migrations to Neon. Local PGlite migrates itself on open. */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DATABASE_URL is not set; local PGlite migrates automatically.");
  process.exit(0);
}
const pool = new Pool({ connectionString: url });
await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
await pool.end();
console.log("Migrations applied.");
