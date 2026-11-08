import { timingSafeEqual } from "node:crypto";
import { AppError } from "./validation";

/** Hostnames the local app answers to. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Refuses requests whose Host header is not this computer. The app listens on
 * 127.0.0.1 only; this also blocks DNS-rebinding pages that point their own
 * domain at 127.0.0.1 to read the private API.
 */
export function localRequest(request: Request) {
  const host = request.headers.get("host") || new URL(request.url).host;
  let name = "";
  try {
    name = new URL("http://" + host).hostname.toLowerCase();
  } catch {}
  if (!LOCAL_HOSTS.has(name))
    throw new AppError(403, "Fieldwork only answers on this computer.");
}
export function requireWorker(request: Request) {
  const key = process.env.WORKER_TOKEN || "";
  const supplied = request.headers.get("authorization") || "";
  const target = `Bearer ${key}`;
  if (
    key.length < 32 ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(target) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(target))
  )
    throw new AppError(401, "Worker authentication required.");
}
/** Blocks other websites from sending changes to the local app (CSRF). */
export function sameOrigin(request: Request) {
  // Compare against the Host header the browser used: Next reports
  // request.url as localhost even when the page was opened on 127.0.0.1.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || new URL(request.url).host;
  let originHost = "";
  try {
    const o = new URL(origin || "");
    if (o.protocol === "http:" || o.protocol === "https:") originHost = o.host;
  } catch {}
  if (!originHost || originHost.toLowerCase() !== host.toLowerCase())
    throw new AppError(403, "Same-origin request required.");
}
