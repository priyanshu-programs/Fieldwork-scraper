import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { CrawlerService } from "../src/lib/service";
import { applyMigrations, pgliteDatabase } from "../src/lib/db";

let pg: PGlite;
let service: CrawlerService;
beforeEach(async () => {
  pg = new PGlite();
  await applyMigrations(pg);
  service = new CrawlerService(pgliteDatabase(pg));
});
afterEach(async () => {
  await pg.close();
});
const newRun = (
  folder_id: string | null = null,
  url = "https://example.com/",
) => service.create({ urls: [url], folder_id });
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
};

describe("folders", () => {
  it("nests folders and refuses duplicate sibling names, case-insensitively", async () => {
    const a = await service.createFolder({ name: "Research" });
    const b = await service.createFolder({ name: "Pricing", parent_id: a.id });
    expect(b.parent_id).toBe(a.id);
    expect(await status(service.createFolder({ name: "research" }))).toBe(409);
    // Same name under a different parent is fine.
    await service.createFolder({ name: "Research", parent_id: a.id });
    expect(
      await status(
        service.createFolder({ name: "x", parent_id: randomUUID() }),
      ),
    ).toBe(400);
    expect(await status(service.createFolder({ name: "   " }))).toBe(-1);
  });

  it("renames and moves folders but never into themselves", async () => {
    const a = await service.createFolder({ name: "A" });
    const b = await service.createFolder({ name: "B", parent_id: a.id });
    const c = await service.createFolder({ name: "C", parent_id: b.id });
    expect((await service.updateFolder(a.id, { name: "Alpha" })).name).toBe(
      "Alpha",
    );
    expect(await status(service.updateFolder(a.id, { parent_id: c.id }))).toBe(
      400,
    );
    expect(await status(service.updateFolder(a.id, { parent_id: a.id }))).toBe(
      400,
    );
    const moved = await service.updateFolder(c.id, { parent_id: null });
    expect(moved.parent_id).toBeNull();
  });

  it("deleting a folder keeps its runs and subfolders by moving them up", async () => {
    const top = await service.createFolder({ name: "Top" });
    const mid = await service.createFolder({ name: "Mid", parent_id: top.id });
    const leaf = await service.createFolder({
      name: "Leaf",
      parent_id: mid.id,
    });
    const run = await newRun(mid.id);
    await service.deleteFolder(mid.id);
    const { folders, runs } = await service.folders();
    expect(folders.find((f) => f.id === mid.id)).toBeUndefined();
    expect(folders.find((f) => f.id === leaf.id)?.parent_id).toBe(top.id);
    expect(runs.find((r) => r.id === run.id)?.folder_id).toBe(top.id);
    expect((await service.detail(run.id)).run.id).toBe(run.id);
  });

  it("files new runs, filters the list by folder and moves runs", async () => {
    const f = await service.createFolder({ name: "Docs" });
    const inside = await newRun(f.id, "https://example.com/a");
    const outside = await newRun(null, "https://example.com/b");
    const ids = async (folder: string) =>
      (await service.list(new URLSearchParams({ folder }))).runs.map(
        (r) => r.id,
      );
    expect(await ids(f.id)).toEqual([inside.id]);
    expect(await ids("root")).toEqual([outside.id]);
    expect((await ids("")).length).toBe(2);
    await expect(
      service.list(new URLSearchParams({ folder: "nope" })),
    ).rejects.toThrow();
    expect(await status(newRun(randomUUID()))).toBe(400);
    expect(
      await service.moveRuns({ ids: [outside.id], folder_id: f.id }),
    ).toEqual({ moved: 1 });
    expect((await ids(f.id)).sort()).toEqual([inside.id, outside.id].sort());
    const counted = await service.folders();
    expect(counted.folders[0].run_count).toBe(2);
  });
});

describe("deleting runs", () => {
  async function finished(folder_id: string | null = null) {
    const run = await newRun(folder_id);
    const { job } = await service.claim();
    const lease = { run_id: run.id, lease_token: job!.lease_token };
    await service.upload({
      ...lease,
      page: {
        id: randomUUID(),
        url: "https://example.com/",
        status: "failed",
        error: "x",
        markdown: "",
        collected_at: "2026-11-07T10:00:00Z",
      },
    });
    await service.finish(lease);
    return run;
  }

  it("removes runs and their pages, keeps linked retries, and keeps the folder", async () => {
    const f = await service.createFolder({ name: "Keep" });
    const run = await finished(f.id);
    const retry = await service.retry(run.id);
    expect(retry.folder_id).toBe(f.id);
    expect(await service.deleteRuns({ ids: [run.id] })).toEqual({ deleted: 1 });
    expect(await status(service.detail(run.id))).toBe(404);
    const pages = await pg.query("SELECT 1 FROM pages WHERE run_id=$1", [
      run.id,
    ]);
    expect(pages.rows).toHaveLength(0);
    const kept = await service.detail(retry.id);
    expect(kept.run.retry_of).toBeNull();
    expect((await service.folders()).folders).toHaveLength(1);
  });

  it("refuses to delete a run that is collecting, but allows a queued one", async () => {
    const running = await newRun();
    await service.claim();
    expect(await status(service.deleteRuns({ ids: [running.id] }))).toBe(409);
    const queued = await newRun(null, "https://example.com/q");
    expect(await service.deleteRuns({ ids: [queued.id] })).toEqual({
      deleted: 1,
    });
    expect((await service.detail(running.id)).run.status).toBe("running");
  });
});

describe("manual folder order", () => {
  const names = async (parent: string | null) =>
    (await service.folders()).folders
      .filter((f) => f.parent_id === parent)
      .map((f) => f.name);

  it("appends new folders and reorders siblings before or after another", async () => {
    const c = await service.createFolder({ name: "C" });
    const a = await service.createFolder({ name: "A" });
    const b = await service.createFolder({ name: "B" });
    expect(await names(null)).toEqual(["C", "A", "B"]);
    await service.moveFolder(b.id, { parent_id: null, before_id: c.id });
    expect(await names(null)).toEqual(["B", "C", "A"]);
    await service.moveFolder(b.id, { parent_id: null, after_id: a.id });
    expect(await names(null)).toEqual(["C", "A", "B"]);
    await service.moveFolder(c.id, { parent_id: null });
    expect(await names(null)).toEqual(["A", "B", "C"]);
  });

  it("moves folders between levels, keeps order inside, and refuses loops", async () => {
    const top = await service.createFolder({ name: "Top" });
    const x = await service.createFolder({ name: "X", parent_id: top.id });
    const y = await service.createFolder({ name: "Y", parent_id: top.id });
    const loose = await service.createFolder({ name: "Loose" });
    await service.moveFolder(loose.id, { parent_id: top.id, before_id: y.id });
    expect(await names(top.id)).toEqual(["X", "Loose", "Y"]);
    expect(await names(null)).toEqual(["Top"]);
    await service.moveFolder(x.id, { parent_id: null, before_id: top.id });
    expect(await names(null)).toEqual(["X", "Top"]);
    expect(await status(service.moveFolder(top.id, { parent_id: y.id }))).toBe(
      400,
    );
    expect(
      await status(
        service.moveFolder(y.id, { parent_id: null, before_id: loose.id }),
      ),
    ).toBe(400);
    await service.createFolder({ name: "Y" });
    expect(await status(service.moveFolder(y.id, { parent_id: null }))).toBe(
      409,
    );
  });
});
