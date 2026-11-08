import { it, expect, afterEach, vi } from "vitest";
import { localRequest, requireWorker, sameOrigin } from "../src/lib/security";
import { createRunSchema } from "../src/lib/validation";
import { validateUpdate } from "../scripts/check-change.mjs";
afterEach(() => vi.unstubAllEnvs());
it("answers only requests addressed to this computer", () => {
  const at = (host: string) =>
    new Request("http://127.0.0.1:3000/api/runs", { headers: { host } });
  for (const host of [
    "localhost:3000",
    "127.0.0.1:3000",
    "[::1]:3000",
    "LOCALHOST",
  ])
    expect(() => localRequest(at(host))).not.toThrow();
  // A DNS-rebinding page keeps its own domain in the Host header.
  for (const host of [
    "evil.example",
    "evil.example:3000",
    "192.168.1.5:3000",
    "localhost.evil.example",
  ])
    expect(() => localRequest(at(host))).toThrow();
});
it("rejects missing or incorrect worker credentials", () => {
  vi.stubEnv("WORKER_TOKEN", "a".repeat(40));
  expect(() =>
    requireWorker(new Request("https://app.example/api/worker/claim")),
  ).toThrow();
  expect(() =>
    requireWorker(
      new Request("https://app.example", {
        headers: { authorization: "Bearer " + "a".repeat(40) },
      }),
    ),
  ).not.toThrow();
});
it("rejects cross-origin changes", () => {
  expect(() =>
    sameOrigin(
      new Request("https://app.example/api/runs", {
        headers: { origin: "https://evil.example" },
      }),
    ),
  ).toThrow();
});
it("matches the origin against the Host the browser used, not request.url", () => {
  // Next reports request.url as localhost even when opened on 127.0.0.1.
  const req = (origin: string) =>
    new Request("http://localhost:3000/api/folders/x", {
      method: "DELETE",
      headers: { host: "127.0.0.1:3000", origin },
    });
  expect(() => sameOrigin(req("http://127.0.0.1:3000"))).not.toThrow();
  expect(() => sameOrigin(req("http://localhost:3000"))).toThrow();
  expect(() => sameOrigin(req("null"))).toThrow();
});
it("rejects unsafe URL inputs", () => {
  for (const url of [
    "file:///etc/passwd",
    "http://localhost/a",
    "http://127.0.0.1",
    "https://user:pass@example.com",
    "http://example.com:8080",
    "http://localhost./a",
    "http://printer.local./",
  ])
    expect(() => createRunSchema.parse({ urls: [url] })).toThrow();
});
it("requires a fresh full update with real decision references", () => {
  const decisions = "## D001 | 2026-11-07 | Accepted";
  const entry =
    "## U001 | 2026-11-07T17:00:00+05:30\n- Tasks: P0.2\n- Changes and reason: enforce logs\n- Files: scripts\n- Checks: passed\n- Decisions: D001\n- Blockers: none\n- Next: build";
  expect(() => validateUpdate("", entry, decisions)).not.toThrow();
  expect(() => validateUpdate(entry, entry, decisions)).toThrow("new updates");
  expect(() =>
    validateUpdate("", entry.replace("D001", "D999"), decisions),
  ).toThrow("Unknown decision");
});
