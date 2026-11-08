import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  appendFile,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { execFileSync } from "node:child_process";
const entry = (id: string) =>
  `\n## ${id} | 2026-11-07T18:00:00+05:30\n- Tasks: P0.2\n- Changes and reason: fixture\n- Files: fixture\n- Checks: fixture\n- Decisions: D001\n- Blockers: none\n- Next: test\n`;
it("the real shared hooks require a fresh entry in the private local updates.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crawler-hook-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    await mkdir(join(dir, "scripts"));
    await mkdir(join(dir, ".githooks"));
    for (const file of [
      "scripts/check-change.mjs",
      "scripts/check-secrets.mjs",
      ".githooks/pre-commit",
      ".githooks/post-commit",
    ])
      await copyFile(file, join(dir, file));
    // The logs stay out of Git, as in the real repository.
    await writeFile(join(dir, ".gitignore"), "updates.md\ndecisions.md\n");
    await writeFile(
      join(dir, "decisions.md"),
      "## D001 | 2026-11-07 | Accepted\n",
    );
    await writeFile(join(dir, "updates.md"), "# Updates\n" + entry("U001"));
    git("init");
    git("config", "user.name", "Test fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.hooksPath", ".githooks");
    git("add", ".");
    git("commit", "-m", "Initial fixture");
    expect(git("ls-files")).not.toContain("updates.md");

    await writeFile(join(dir, "code.js"), "export const value=1;\n");
    git("add", "code.js");
    expect(() => git("commit", "-m", "Unlogged fixture change")).toThrow();
    expect(git("rev-list", "--count", "HEAD").trim()).toBe("1");

    await appendFile(join(dir, "updates.md"), entry("U002"));
    git("commit", "-m", "Logged fixture change");
    expect(git("rev-list", "--count", "HEAD").trim()).toBe("2");

    // post-commit saved the new log, so the next change needs another entry.
    await writeFile(join(dir, "code.js"), "export const value=2;\n");
    git("add", "code.js");
    expect(() => git("commit", "-m", "Second unlogged change")).toThrow();
  } finally {
    const resolved = await realpath(dir);
    const root = await realpath(tmpdir());
    if (!resolved.startsWith(root + sep + "crawler-hook-"))
      throw Error("Unexpected test cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
});

it("skips the log check in clones without a local updates.md", () => {
  const out = execFileSync(
    "node",
    [join(process.cwd(), "scripts/check-change.mjs"), "--staged"],
    { cwd: tmpdir(), encoding: "utf8" },
  );
  expect(out).toContain("skipped");
});
