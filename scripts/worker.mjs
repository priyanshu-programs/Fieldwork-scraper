// Starts the Python collection worker from the project venv on any OS.
// Usage: npm run worker [-- --once]
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
const python =
  process.platform === "win32"
    ? ".venv\\Scripts\\python.exe"
    : ".venv/bin/python";
if (!existsSync(python)) {
  console.error("Worker environment missing. Run `npm run setup` first.");
  process.exit(1);
}
if (!existsSync("worker/.env.local")) {
  console.error("worker/.env.local missing. Run `npm run setup` first.");
  process.exit(1);
}
const child = spawn(python, ["-m", "worker.main", ...process.argv.slice(2)], {
  stdio: "inherit",
});
// Ctrl+C reaches the child through the shared console; just mirror its exit.
process.on("SIGINT", () => {});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
