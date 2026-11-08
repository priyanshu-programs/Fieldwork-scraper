import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 20_000_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
export function validateUpdate(oldText, newText, decisions) {
  const pattern = /^## (U\d+) \| (.+)$/gm;
  const previous = new Set([...oldText.matchAll(pattern)].map((m) => m[1]));
  const entries = [...newText.matchAll(pattern)];
  if (new Set(entries.map((m) => m[1])).size !== entries.length)
    throw Error("Duplicate update ID");
  const fresh = entries.filter((m) => !previous.has(m[1]));
  if (!fresh.length) throw Error("Add a new updates.md entry for this change");
  for (const old of [...oldText.matchAll(pattern)]) {
    const end = oldText.indexOf("\n## ", old.index + 1);
    const block = oldText.slice(old.index, end < 0 ? undefined : end).trim();
    if (!newText.includes(block))
      throw Error("Preserve existing update entries");
  }
  for (const match of fresh) {
    if (
      !/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(match[2]) ||
      Number.isNaN(Date.parse(match[2]))
    )
      throw Error("Update needs an ISO timestamp with timezone");
    const end = newText.indexOf("\n## ", match.index + 1);
    const block = newText.slice(match.index, end < 0 ? undefined : end);
    for (const field of [
      "Tasks",
      "Changes and reason",
      "Files",
      "Checks",
      "Decisions",
      "Blockers",
      "Next",
    ])
      if (!block.includes(`- ${field}:`))
        throw Error(`Missing update field: ${field}`);
    for (const ref of block.match(/\bD\d{3,}\b/g) || [])
      if (!new RegExp(`^## ${ref} \\|`, "m").test(decisions))
        throw Error(`Unknown decision ${ref}`);
  }
}
// updates.md and decisions.md are the owner's private working logs: they
// live only on the owner's computer and are never committed. After each
// commit, post-commit saves a copy of updates.md inside .git; the next commit
// needs a new, well-formed entry compared with that copy.
// Clones without a local updates.md (everyone else) skip this check.
const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const baselinePath = () => git("rev-parse", "--git-path", "updates-baseline.md");
function record() {
  const updates = read("updates.md");
  if (updates !== null) writeFileSync(baselinePath(), updates);
}
function main() {
  if (process.argv.includes("--record")) return record();
  const updates = read("updates.md");
  if (updates === null) {
    console.log("No local updates.md; change log check skipped");
    return;
  }
  const baseline = read(baselinePath());
  if (baseline === null) {
    record();
    console.log("Change log baseline saved; check starts with the next commit");
    return;
  }
  if (git("diff", "--cached", "--name-only"))
    validateUpdate(baseline, updates, read("decisions.md") || "");
  console.log("Change log check passed");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
