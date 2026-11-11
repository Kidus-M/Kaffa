/** Resets the synthetic demo organisation. Uses Neon when DATABASE_URL is set, else local PGlite. */
import { getDb } from "@/db/client";
import { seedDemo } from "@/db/seed";

const db = await getDb();
await seedDemo(db);
console.log("Seeded the synthetic demo organisation.");
process.exit(0);
