import { it, expect } from "vitest";
import { mergeEnv, parseEnv, secret } from "../scripts/setup.mjs";
it("fills only missing or empty keys and keeps comments", () => {
  const before = "# note\nCHROME_PATH=keep\nWORKER_TOKEN=\nAPP_URL=http://x\n";
  const after = mergeEnv(before, {
    CHROME_PATH: "new",
    WORKER_TOKEN: "filled",
    SPOOL_DIR: "123",
    UNUSED: undefined,
  });
  expect(after).toBe(
    "# note\nCHROME_PATH=keep\nWORKER_TOKEN=filled\nAPP_URL=http://x\nSPOOL_DIR=123\n",
  );
  expect(parseEnv(after)).toMatchObject({
    CHROME_PATH: "keep",
    WORKER_TOKEN: "filled",
    SPOOL_DIR: "123",
  });
});
it("generates distinct 32-byte secrets long enough for the worker check", () => {
  const a = secret();
  expect(Buffer.from(a, "base64url")).toHaveLength(32);
  expect(a.length).toBeGreaterThanOrEqual(32);
  expect(secret()).not.toBe(a);
});
