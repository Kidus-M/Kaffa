import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("returns defaults when nothing is set", () => {
    const env = parseEnv({});
    expect(env.GEMINI_MODEL).toBe("gemini-3.5-flash,gemini-3.5-flash-lite");
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ GFW_API_KEY: "" }).GFW_API_KEY).toBeUndefined();
  });

  it("rejects a malformed APP_URL", () => {
    expect(() => parseEnv({ APP_URL: "not a url" })).toThrow();
  });
});
