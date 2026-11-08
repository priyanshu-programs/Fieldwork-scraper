import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
export interface Query {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Query {
  transaction<T>(fn: (q: Query) => Promise<T>): Promise<T>;
}
/** Wraps an open PGlite instance in the app's Database interface. */
export function pgliteDatabase(pg: PGlite): Database {
  return {
    query: (text, values) => pg.query(text, values) as never,
    transaction: (fn) => pg.transaction((q) => fn(q as unknown as Query)),
  };
}
/**
 * Applies migrations/*.sql in order, recording each file and its SHA-256
 * checksum in schema_migrations. A changed applied file throws.
 */
export async function applyMigrations(pg: PGlite, directory = "migrations") {
  const applied: string[] = [];
  await pg.transaction(async (tx) => {
    await tx.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())",
    );
    // Migrations are read from the project folder at run time, not bundled,
    // so tell Turbopack not to trace the whole project for these calls.
    const names = (await readdir(/*turbopackIgnore: true*/ directory))
      .filter((n) => n.endsWith(".sql"))
      .sort();
    for (const name of names) {
      const source = await readFile(
        /*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ directory, name),
        "utf8",
      );
      const hash = createHash("sha256").update(source).digest("hex");
      const old = await tx.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (old.rows.length) {
        if (old.rows[0].checksum !== hash)
          throw Error(`Migration modified: ${name}`);
        continue;
      }
      await tx.exec(source);
      await tx.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, hash],
      );
      applied.push(name);
    }
  });
  return applied;
}
/** Opens the local embedded database and migrates it. */
export async function openLocalDatabase(
  directory = process.env.LOCAL_DATABASE_DIR || ".runtime/db",
) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(directory);
  try {
    await applyMigrations(pg);
  } catch (e) {
    await pg.close();
    throw e;
  }
  return pg;
}
function localDatabase(): Database {
  // One instance per process, kept across dev-server hot reloads.
  const cache = globalThis as { __fieldworkLocalDb?: Promise<PGlite> };
  const ready = () => {
    if (!cache.__fieldworkLocalDb) {
      cache.__fieldworkLocalDb = openLocalDatabase();
      cache.__fieldworkLocalDb.catch(() => {
        cache.__fieldworkLocalDb = undefined;
      });
    }
    return cache.__fieldworkLocalDb;
  };
  return {
    query: async (text, values) =>
      pgliteDatabase(await ready()).query(text, values),
    transaction: async (fn) => pgliteDatabase(await ready()).transaction(fn),
  };
}
let database: Database | undefined;
/** The app's only database: embedded PGlite at .runtime/db. */
export function getDatabase(): Database {
  database ??= localDatabase();
  return database;
}
