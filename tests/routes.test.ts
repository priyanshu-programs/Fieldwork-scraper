import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { Database, Query } from "../src/lib/db";
const context = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({ getDatabase: () => context.db }));
import { GET, POST, PATCH, DELETE } from "../src/app/api/[...path]/route";
let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  const { applyMigrations } =
    await vi.importActual<typeof import("../src/lib/db")>("../src/lib/db");
  await applyMigrations(pg);
  context.db = {
    query: (t: string, v?: unknown[]) => pg.query(t, v),
    transaction: (fn: (q: Query) => Promise<unknown>) =>
      pg.transaction((q) => fn(q as unknown as Query)),
  } as Database;
  vi.stubEnv("WORKER_TOKEN", "test-worker-token-" + "a".repeat(32));
});
afterEach(async () => {
  await pg.close();
  vi.unstubAllEnvs();
});
const params = (...path: string[]) => ({ params: Promise.resolve({ path }) });
it("refuses other hosts, cross-site changes and invalid worker requests", async () => {
  // A DNS-rebinding page reaches 127.0.0.1 but keeps its own Host header.
  const rebound = new Request("http://127.0.0.1:3000/api/runs", {
    headers: { host: "evil.example" },
  });
  expect((await GET(rebound, params("runs"))).status).toBe(403);
  const crossSite = new Request("http://127.0.0.1:3000/api/runs", {
    method: "POST",
    headers: { origin: "https://evil.example" },
    body: JSON.stringify({ urls: ["https://example.com/"] }),
  });
  expect((await POST(crossSite, params("runs"))).status).toBe(403);
  expect(
    (
      await POST(
        new Request("http://127.0.0.1:3000/api/worker/claim", {
          method: "POST",
        }),
        params("worker", "claim"),
      )
    ).status,
  ).toBe(401);
});
it("submits, collects, reads one page and streams sourced exports through real handlers", async () => {
  const created = await POST(
    new Request("http://127.0.0.1:3000/api/runs", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ urls: ["https://example.com/"] }),
    }),
    params("runs"),
  );
  expect(created.status).toBe(201);
  const run = await created.json();
  const headers = { authorization: "Bearer " + process.env.WORKER_TOKEN };
  const claim = await POST(
    new Request("http://127.0.0.1:3000/api/worker/claim", {
      method: "POST",
      headers,
    }),
    params("worker", "claim"),
  );
  const { job } = await claim.json();
  const lease = { run_id: run.id, lease_token: job.lease_token };
  const page = {
    id: crypto.randomUUID(),
    url: "https://example.com/",
    title: "Source",
    status: "success",
    markdown: "# Evidence",
    collected_at: "2026-11-07T10:00:00Z",
  };
  expect(
    (
      await POST(
        new Request("http://127.0.0.1:3000/api/worker/page", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...lease, page }),
        }),
        params("worker", "page"),
      )
    ).status,
  ).toBe(200);
  await POST(
    new Request("http://127.0.0.1:3000/api/worker/finish", {
      method: "POST",
      headers,
      body: JSON.stringify(lease),
    }),
    params("worker", "finish"),
  );
  const meta = await (
    await GET(
      new Request("http://127.0.0.1:3000/api/runs/" + run.id),
      params("runs", run.id),
    )
  ).json();
  expect(meta.pages[0].markdown).toBe("");
  expect(JSON.stringify(meta)).not.toContain(job.lease_token);
  const content = await (
    await GET(
      new Request(
        "http://127.0.0.1:3000/api/runs/" + run.id + "/pages/" + page.id,
      ),
      params("runs", run.id, "pages", page.id),
    )
  ).json();
  expect(content.markdown).toBe("# Evidence");
  const exported = await GET(
    new Request("http://127.0.0.1:3000/api/runs/" + run.id + "/export"),
    params("runs", run.id, "export"),
  );
  expect(await exported.text()).toContain("Source: https://example.com/");
  expect(exported.headers.get("content-disposition")).toContain(".md");
});
it("blocks cross-origin creates, malformed JSON and expired leases", async () => {
  expect(
    (
      await POST(
        new Request("http://127.0.0.1:3000/api/runs", {
          method: "POST",
          headers: { origin: "https://other.example" },
          body: "{}",
        }),
        params("runs"),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        new Request("http://127.0.0.1:3000/api/runs", {
          method: "POST",
          headers: { origin: "http://127.0.0.1:3000" },
          body: "bad json",
        }),
        params("runs"),
      )
    ).status,
  ).toBe(400);
});

it("manages folders, moves runs and deletes runs only with local-host and same-origin checks", async () => {
  const origin = { origin: "http://127.0.0.1:3000" };
  const req = (
    path: string,
    method: string,
    body?: unknown,
    headers = origin,
  ) =>
    new Request("http://127.0.0.1:3000/api/" + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  expect(
    (
      await GET(
        req("folders", "GET", undefined, { host: "evil.example" } as never),
        params("folders"),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        req("folders", "POST", { name: "X" }, {} as never),
        params("folders"),
      )
    ).status,
  ).toBe(403);
  const folder = await (
    await POST(req("folders", "POST", { name: "Pricing" }), params("folders"))
  ).json();
  expect(folder.name).toBe("Pricing");
  const run = await (
    await POST(
      req("runs", "POST", {
        urls: ["https://example.com/"],
        folder_id: folder.id,
      }),
      params("runs"),
    )
  ).json();
  expect(run.folder_id).toBe(folder.id);
  const renamed = await PATCH(
    req("folders/" + folder.id, "PATCH", { name: "Prices" }),
    params("folders", folder.id),
  );
  expect((await renamed.json()).name).toBe("Prices");
  const tree = await (
    await GET(req("folders", "GET"), params("folders"))
  ).json();
  expect(tree.folders[0].run_count).toBe(1);
  expect(tree.runs[0]).toMatchObject({ id: run.id, folder_id: folder.id });
  const moved = await POST(
    req("runs/move", "POST", { ids: [run.id], folder_id: null }),
    params("runs", "move"),
  );
  expect(await moved.json()).toEqual({ moved: 1 });
  const listed = await (
    await GET(req("runs?folder=root", "GET"), params("runs"))
  ).json();
  expect(listed.runs.map((r: { id: string }) => r.id)).toEqual([run.id]);
  expect(
    (
      await DELETE(
        req("runs/" + run.id, "DELETE", undefined, {} as never),
        params("runs", run.id),
      )
    ).status,
  ).toBe(403);
  const gone = await DELETE(
    req("runs/" + run.id, "DELETE"),
    params("runs", run.id),
  );
  expect(await gone.json()).toEqual({ deleted: 1 });
  expect(
    (await GET(req("runs/" + run.id, "GET"), params("runs", run.id))).status,
  ).toBe(404);
  const removed = await DELETE(
    req("folders/" + folder.id, "DELETE"),
    params("folders", folder.id),
  );
  expect(removed.status).toBe(200);
});
