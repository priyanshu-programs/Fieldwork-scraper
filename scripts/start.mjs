// Everyday start: build the app, then run the production server and the
// worker together in this window. Ctrl+C stops both.
// Usage: npm run app
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = 3000;
const next = "node_modules/next/dist/bin/next";
const python =
  process.platform === "win32"
    ? ".venv\\Scripts\\python.exe"
    : ".venv/bin/python";

for (const [file, hint] of [
  [next, "Run `npm ci` first."],
  [".env.local", "Run `npm run setup` first."],
  ["worker/.env.local", "Run `npm run setup` first."],
  [python, "Run `npm run setup` first."],
])
  if (!existsSync(file)) {
    console.error(`${file} missing. ${hint}`);
    process.exit(1);
  }

const portFree = () =>
  new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(PORT, HOST);
  });

if (!(await portFree())) {
  console.error(`
Port ${PORT} is already in use, so Fieldwork cannot start.
Usually an older Fieldwork window (npm run dev or npm run app) is still open.
Find that window and press Ctrl+C, then run npm run app again.`);
  process.exit(1);
}

console.log("Building Fieldwork (about a minute)...");
const build = spawnSync(process.execPath, [next, "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [
  spawn(process.execPath, [next, "start", "--hostname", HOST, "--port", String(PORT)], {
    stdio: "inherit",
  }),
  spawn(python, ["-m", "worker.main"], { stdio: "inherit" }),
];

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exitCode = code;
};
// Ctrl+C reaches the children through the shared console; just wind down.
process.on("SIGINT", () => stop(0));
for (const c of children)
  c.on("exit", (code, signal) => {
    if (!stopping && code)
      console.error("\nFieldwork stopped because one part exited with an error (see above).");
    stop(signal ? 0 : (code ?? 0));
  });

// Announce only once the app actually answers.
for (let i = 0; i < 120 && !stopping; i++) {
  try {
    const r = await fetch(`http://${HOST}:${PORT}/api/system`);
    if (r.ok) {
      console.log(
        `\nFieldwork is running: open http://${HOST}:${PORT}  (Ctrl+C stops the app and the worker)\n`,
      );
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
