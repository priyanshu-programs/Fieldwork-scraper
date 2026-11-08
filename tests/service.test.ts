import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { CrawlerService } from "../src/lib/service";
import type { Database, Query } from "../src/lib/db";
import { applyMigrations } from "../src/lib/db";
import { combinedMarkdown, backupJson } from "../src/lib/export";
import { restoreRun } from "../scripts/restore-lib.mjs";
let pg: PGlite;
let service: CrawlerService;
let db: Database;
const input = {
  title: "Evidence",
  description: "Source notes",
  urls: ["https://example.com/a", "https://example.com/a"],
  mode: "pages",
  fetch_mode: "http",
};
const page = (url = "https://example.com/a") => ({
  id: randomUUID(),
  url,
  final_url: url,
  parent_url: null,
  title: "Page",
  status: "success",
  error: null,
  markdown: "# Saved\n\nOriginal content",
  collected_at: "2026-11-07T10:00:00Z",
});
beforeEach(async () => {
  pg = new PGlite();
  await applyMigrations(pg);
  db = {
    query: (t, v) => pg.query(t, v) as never,
    transaction: (fn) => pg.transaction((q) => fn(q as unknown as Query)),
  };
  service = new CrawlerService(db);
});
afterEach(async () => {
  await pg.close();
});
describe("collection history", () => {
  it("deduplicates input; leases one job; saves and exports idempotently", async () => {
    const run = await service.create(input);
    expect(run.urls).toHaveLength(1);
    expect("lease_token" in run).toBe(false);
    const { job } = await service.claim();
    expect(job?.id).toBe(run.id);
    expect((await service.claim()).job).toBeNull();
    const lease = { run_id: run.id, lease_token: job!.lease_token };
    expect(await service.heartbeat(lease)).toEqual({ ok: true });
    const p = page();
    await service.upload({ ...lease, page: p });
    expect((await service.upload({ ...lease, page: p })).duplicate).toBe(true);
    expect((await service.finish(lease)).status).toBe("completed");
    const detail = await service.detail(run.id);
    expect(detail.pages).toHaveLength(1);
    expect(detail.run.byte_count).toBe(Buffer.byteLength(p.markdown));
    expect(combinedMarkdown(detail)).toContain("Source: https://example.com/a");
    expect(combinedMarkdown(detail)).toContain("2026-11-07T10:00:00.000Z");
    expect(
      (
        await service.list(
          new URLSearchParams("q=example.com&status=completed"),
        )
      ).runs,
    ).toHaveLength(1);
  });
  it("interrupts stale work, rejects old uploads and preserves partial output", async () => {
    const run = await service.create({
      ...input,
      urls: ["https://example.com/a", "https://example.com/b"],
    });
    const { job } = await service.claim();
    const lease = { run_id: run.id, lease_token: job!.lease_token };
    await service.upload({ ...lease, page: page() });
    await db.query(
      "UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [run.id],
    );
    await expect(
      service.upload({ ...lease, page: page("https://example.com/b") }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.detail(run.id)).run.status).toBe("interrupted");
    const retry = await service.retry(run.id);
    expect(retry.retry_of).toBe(run.id);
    expect(retry.urls).toEqual(["https://example.com/b"]);
    expect((await service.detail(run.id)).pages).toHaveLength(1);
  });
  it("records mixed results as partial and preserves repeat runs", async () => {
    const r = await service.create({
      ...input,
      urls: ["https://example.com/a", "https://example.com/b"],
    });
    const { job } = await service.claim();
    const l = { run_id: r.id, lease_token: job!.lease_token };
    await service.upload({ ...l, page: page() });
    await service.upload({
      ...l,
      page: {
        ...page("https://example.com/b"),
        status: "failed",
        markdown: "",
        error: "HTTP 500",
      },
    });
    expect((await service.finish(l)).status).toBe("partial");
    const next = await service.create(input);
    expect(next.id).not.toBe(r.id);
  });
  it("enforces pages, host and byte limits", async () => {
    await expect(
      service.create({
        ...input,
        urls: Array.from({ length: 26 }, (_, i) => `https://example.com/${i}`),
      }),
    ).rejects.toThrow();
    const run = await service.create({ ...input, mode: "crawl" });
    const { job } = await service.claim();
    const l = { run_id: run.id, lease_token: job!.lease_token };
    await expect(
      service.upload({ ...l, page: page("https://other.example/a") }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.upload({
        ...l,
        page: { ...page(), markdown: "x".repeat(500001) },
      }),
    ).rejects.toThrow();
  });
  it("restores exported content without overwriting existing history", async () => {
    const run = await service.create(input);
    const { job } = await service.claim();
    const l = { run_id: run.id, lease_token: job!.lease_token };
    await service.upload({ ...l, page: page() });
    await service.finish(l);
    const backup = JSON.parse(backupJson(await service.detail(run.id)));
    const target = new PGlite();
    try {
      await target.exec(await readFile("migrations/001_initial.sql", "utf8"));
      await target.transaction((q) => restoreRun(q, backup));
      const result = await target.query<{ markdown: string }>(
        "SELECT markdown FROM pages",
      );
      expect(result.rows[0].markdown).toBe(backup.pages[0].markdown);
      await expect(
        target.transaction((q) => restoreRun(q, backup)),
      ).rejects.toThrow();
    } finally {
      await target.close();
    }
  });
});

it("orders leased Collector events and rejects stale credentials", async () => {
  const run = await service.create(input);
  const { job } = await service.claim();
  const lease = { run_id: run.id, lease_token: job!.lease_token };
  await service.progress({
    ...lease,
    seq: 2,
    stage: "cleaning",
    url: input.urls[0],
  });
  await service.progress({
    ...lease,
    seq: 1,
    stage: "fetching",
    url: input.urls[0],
  });
  expect((await service.detail(run.id)).run.progress?.stage).toBe("cleaning");
  await expect(
    service.progress({
      ...lease,
      lease_token: randomUUID(),
      seq: 3,
      stage: "saving",
      url: input.urls[0],
    }),
  ).rejects.toMatchObject({ status: 409 });
});
