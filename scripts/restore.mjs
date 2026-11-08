// Restores one exported run (research-crawler/v1 JSON) into the local database.
// Usage: npm run backup:restore -- <backup.json> --confirm
// Stop the app first: the local database allows one process at a time.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { restoreRun } from "./restore-lib.mjs";
if (!process.argv.includes("--confirm"))
  throw Error(
    "Run backup:restore -- <backup.json> --confirm with the app stopped. Existing IDs are never overwritten.",
  );
const file = process.argv.slice(2).find((x) => x !== "--confirm");
if (!file) throw Error("Backup file required");
const data = JSON.parse(await readFile(file, "utf8"));
const pg = new PGlite(process.env.LOCAL_DATABASE_DIR || ".runtime/db");
try {
  const ready = await pg.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name='runs'",
  );
  if (!ready.rows.length)
    throw Error("Local database is empty. Start the app once to create it.");
  const id = await pg.transaction((tx) => restoreRun(tx, data));
  console.log("Restored run", id);
} finally {
  await pg.close();
}
