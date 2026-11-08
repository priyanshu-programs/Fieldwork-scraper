import { afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  cp,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { applyMigrations, getDatabase, openLocalDatabase } from "../src/lib/db";
const dirs: string[] = [];
async function temp() {
  const d = await mkdtemp(join(tmpdir(), "crawler-localdb-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  const cache = globalThis as { __fieldworkLocalDb?: Promise<PGlite> };
  if (cache.__fieldworkLocalDb) await (await cache.__fieldworkLocalDb).close();
  cache.__fieldworkLocalDb = undefined;
  const root = await realpath(tmpdir());
  for (const d of dirs.splice(0)) {
    const resolved = await realpath(d);
    if (!resolved.startsWith(root + sep + "crawler-localdb-"))
      throw Error("Unexpected cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
});
it("opens the migrated local database (the only database)", async () => {
  vi.stubEnv("LOCAL_DATABASE_DIR", await temp());
  const db = getDatabase();
  const r = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM worker_state",
  );
  expect(r.rows[0].n).toBe(1);
  const size = await db.query<{ bytes: string }>(
    "SELECT pg_database_size(current_database())::text AS bytes",
  );
  expect(Number(size.rows[0].bytes)).toBeGreaterThan(0);
});
it("applies migrations once and rejects a modified applied migration", async () => {
  const data = await temp();
  let pg = await openLocalDatabase(data);
  expect(await applyMigrations(pg)).toEqual([]);
  await pg.close();
  pg = await openLocalDatabase(data);
  const rows = await pg.query("SELECT name FROM schema_migrations");
  const files = (await readdir("migrations")).filter((n) => n.endsWith(".sql"));
  expect(rows.rows).toHaveLength(files.length);
  const changed = await temp();
  await cp("migrations", changed, { recursive: true });
  await writeFile(join(changed, "001_initial.sql"), "-- edited\n", {
    flag: "a",
  });
  await expect(applyMigrations(pg, changed)).rejects.toThrow(
    "Migration modified: 001_initial.sql",
  );
  await pg.close();
});
