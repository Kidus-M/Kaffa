import { describe, expect, it, vi } from "vitest";

describe("getDb", () => {
  it("returns one shared database per process, even when the module is loaded twice", async () => {
    // Next.js bundles route handlers and pages separately, so the client module can be
    // instantiated more than once in one server process. Both copies must share the database.
    process.env.DATABASE_URL = "";
    process.env.PGLITE_DIR = "memory://";
    const first = await import("./client");
    vi.resetModules();
    const second = await import("./client");
    expect(first).not.toBe(second);
    expect(first.getDb()).toBe(second.getDb());
  });
});
