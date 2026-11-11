import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    // Database tests start an in-memory Postgres (PGlite) and seed it; give setup room under load.
    hookTimeout: 60_000,
    maxWorkers: 4,
  },
});
