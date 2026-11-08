import { execFileSync } from "node:child_process";
const git = (...a) =>
  execFileSync("git", a, { encoding: "utf8", maxBuffer: 30_000_000 });
const files = git("ls-files", "-z").split("\0").filter(Boolean);
const forbidden =
  /(^|\/)(\.env(?:\..+)?|cookies[^/]*\.json|storage-state[^/]*\.json)$|\.(pem|key|p12|pfx|dump|db|sqlite)$/i;
const patterns = [
  /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/i,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk-proj-|sk-ant-)[A-Za-z0-9_-]{20,}/,
];
let bad = false;
for (const f of files) {
  if (f.endsWith(".env.example")) continue;
  if (forbidden.test(f)) {
    console.error(`Forbidden tracked path: ${f}`);
    bad = true;
    continue;
  }
  if (/(?:package-lock\.json|\.(png|jpg|woff2))$/.test(f)) continue;
  const content = git("show", `:${f}`);
  if (patterns.some((p) => p.test(content))) {
    console.error(`Possible secret in: ${f}`);
    bad = true;
  }
}
if (bad) process.exitCode = 1;
else console.log("Staged secret check passed");
