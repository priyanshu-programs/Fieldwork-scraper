import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { CrawlerService } from "../src/lib/service";
import { pgliteDatabase as adapter, applyMigrations } from "../src/lib/db";
it("preserves the request and page content after a database close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crawler-persistence-"));
  let pg = new PGlite(directory);
  try {
    await applyMigrations(pg);
    let service = new CrawlerService(adapter(pg));
    const run = await service.create({
      urls: ["https://example.com/"],
      description: "Keep this request",
    });
    const { job } = await service.claim();
    const lease = { run_id: run.id, lease_token: job!.lease_token };
    await service.upload({
      ...lease,
      page: {
        id: crypto.randomUUID(),
        url: "https://example.com/",
        status: "success",
        markdown: "Persistent source content",
        collected_at: "2026-11-07T10:00:00Z",
      },
    });
    await service.finish(lease);
    await pg.close();
    pg = new PGlite(directory);
    service = new CrawlerService(adapter(pg));
    const saved = await service.detail(run.id);
    expect(saved.run.description).toBe("Keep this request");
    expect(saved.pages[0].markdown).toBe("Persistent source content");
    expect(saved.run.status).toBe("completed");
  } finally {
    await pg.close();
    const resolved = await realpath(directory);
    const root = await realpath(tmpdir());
    if (!resolved.startsWith(root + sep + "crawler-persistence-"))
      throw Error("Unexpected cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
});
