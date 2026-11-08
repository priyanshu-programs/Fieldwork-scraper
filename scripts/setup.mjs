// One-command setup for a fresh clone of the local-only app.
// Usage: npm run setup [-- --skip-worker]
// Asks no questions. Never overwrites a value already present in .env.local
// or worker/.env.local.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const secret = () => randomBytes(32).toString("base64url");

/** Parses KEY=value lines; comments and blank lines are ignored. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Fills only keys that are missing or empty. Existing non-empty values,
 * comments and line order are kept. Returns the new text.
 */
export function mergeEnv(text, values) {
  const done = new Set();
  const lines = text.split(/\r?\n/).map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m || !(m[1] in values)) return line;
    done.add(m[1]);
    return m[2].trim() === "" && values[m[1]] !== undefined
      ? `${m[1]}=${values[m[1]]}`
      : line;
  });
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [k, v] of Object.entries(values))
    if (!done.has(k) && v !== undefined) lines.push(`${k}=${v}`);
  return lines.join("\n") + "\n";
}

function findPython() {
  const candidates =
    process.platform === "win32"
      ? [["py", "-3.12"], ["py", "-3"], ["python"]]
      : [["python3.12"], ["python3"], ["python"]];
  for (const [cmd, ...args] of candidates) {
    const r = spawnSync(
      cmd,
      [...args, "-c", "import sys;print('%d.%d'%sys.version_info[:2])"],
      { encoding: "utf8" },
    );
    if (r.status !== 0) continue;
    const [major, minor] = r.stdout.trim().split(".").map(Number);
    if (major === 3 && minor >= 10)
      return { cmd, args, version: r.stdout.trim() };
  }
  return null;
}

const venvPython = () =>
  process.platform === "win32"
    ? ".venv\\Scripts\\python.exe"
    : ".venv/bin/python";

function run(cmd, args) {
  console.log(`\n> ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw Error(`Command failed: ${cmd} ${args.join(" ")}`);
}

async function main() {
  const skipWorker = process.argv.includes("--skip-worker");
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 22)
    throw Error(`Node 22+ required, found ${process.versions.node}`);
  console.log("Fieldwork setup. Existing values are kept.\n");

  // 1. Worker token, shared by the app and the worker.
  const appFile = ".env.local";
  const workerFile = "worker/.env.local";
  const appText = existsSync(appFile)
    ? await readFile(appFile, "utf8")
    : await readFile(".env.example", "utf8");
  const workerText = existsSync(workerFile)
    ? await readFile(workerFile, "utf8")
    : await readFile("worker/.env.example", "utf8");
  const app = parseEnv(appText);
  const worker = parseEnv(workerText);
  const token = app.WORKER_TOKEN || worker.WORKER_TOKEN || secret();

  // 2. Env files (both ignored by Git).
  await writeFile(appFile, mergeEnv(appText, { WORKER_TOKEN: token }));
  await writeFile(
    workerFile,
    mergeEnv(workerText, {
      WORKER_TOKEN: token,
      APP_URL: "http://127.0.0.1:3000",
    }),
  );
  if (parseEnv(await readFile(workerFile, "utf8")).WORKER_TOKEN !== token)
    console.warn(
      "\nWarning: WORKER_TOKEN differs between .env.local and worker/.env.local. Make them match or the worker cannot connect.",
    );
  console.log(`Wrote ${appFile} and ${workerFile}.`);

  // 3. Python worker with Scrapling and its browsers.
  if (skipWorker) console.log("\nSkipped worker setup (--skip-worker).");
  else {
    const py = findPython();
    if (!py)
      throw Error(
        "Python 3.10+ not found (3.12 recommended). Install it, then rerun npm run setup.",
      );
    if (py.version !== "3.12")
      console.log(`Using Python ${py.version}; 3.12 is the tested version.`);
    if (!existsSync(venvPython()))
      run(py.cmd, [...py.args, "-m", "venv", ".venv"]);
    run(venvPython(), [
      "-m",
      "pip",
      "install",
      "-r",
      "worker/requirements.lock.txt",
    ]);
    run(venvPython(), [
      "-c",
      "from scrapling.cli import install; install([], standalone_mode=False)",
    ]);
  }

  console.log(`
Setup complete. Every day, start Fieldwork with:
  npm run app    (builds, then runs the app at http://127.0.0.1:3000 and the worker; Ctrl+C stops both)
Your history is stored in .runtime/db.`);
}

const same = (a, b) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
if (process.argv[1] && same(fileURLToPath(import.meta.url), process.argv[1]))
  main().catch((e) => {
    console.error(`\nSetup stopped: ${e.message}`);
    process.exit(1);
  });
