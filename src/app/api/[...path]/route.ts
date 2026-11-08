import { getDatabase } from "@/lib/db";
import { CrawlerService } from "@/lib/service";
import { AppError } from "@/lib/validation";
import { localRequest, requireWorker, sameOrigin } from "@/lib/security";
import { combinedMarkdown, pageMarkdown, backupJson } from "@/lib/export";
import { ZodError } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Request body required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 3200000) {
      await reader.cancel();
      throw new AppError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid JSON.");
  }
}
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    // Local-only app: this computer only, the worker by token,
    // and every browser change from this app's own pages.
    localRequest(request);
    const { path } = await context.params;
    const [section, id, action] = path;
    if (section === "worker") requireWorker(request);
    else if (request.method !== "GET") sameOrigin(request);
    const service = new CrawlerService(getDatabase());
    if (section === "system" && request.method === "GET")
      return Response.json(await service.system());
    if (section === "folders") {
      if (!id && request.method === "GET")
        return Response.json(await service.folders());
      if (!id && request.method === "POST")
        return Response.json(await service.createFolder(await body(request)), {
          status: 201,
        });
      if (id && !action && request.method === "PATCH")
        return Response.json(
          await service.updateFolder(id, await body(request)),
        );
      if (id && !action && request.method === "DELETE")
        return Response.json(await service.deleteFolder(id));
      if (id && action === "move" && request.method === "POST")
        return Response.json(await service.moveFolder(id, await body(request)));
    }
    if (section === "runs" && request.method === "POST" && !action) {
      if (id === "move")
        return Response.json(await service.moveRuns(await body(request)));
      if (id === "delete")
        return Response.json(await service.deleteRuns(await body(request)));
    }
    if (section === "runs" && id && !action && request.method === "DELETE")
      return Response.json(await service.deleteRuns({ ids: [id] }));
    if (section === "runs") {
      if (!id) {
        if (request.method === "GET")
          return Response.json(
            await service.list(new URL(request.url).searchParams),
          );
        if (request.method === "POST")
          return Response.json(await service.create(await body(request)), {
            status: 201,
          });
      }
      if (id && request.method === "GET") {
        const detail = await service.detail(id);
        if (action === "export") {
          const p = new URL(request.url).searchParams;
          const json = p.get("format") === "json";
          const page = p.get("page");
          const item = page
            ? detail.pages.find((x) => x.id === page)
            : undefined;
          if (page && !item) throw new AppError(404, "Page not found.");
          const text = json
            ? backupJson(detail)
            : item
              ? pageMarkdown(item)
              : combinedMarkdown(detail);
          const bytes = new TextEncoder().encode(text);
          let offset = 0;
          const stream = new ReadableStream({
            pull(controller) {
              if (offset >= bytes.length) {
                controller.close();
                return;
              }
              controller.enqueue(bytes.slice(offset, offset + 64000));
              offset += 64000;
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": json
                ? "application/json; charset=utf-8"
                : "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="run-${detail.run.id}${item ? "-" + item.id : ""}.${json ? "json" : "md"}"`,
              "Cache-Control": "private, no-store",
            },
          });
        }
        if (action === "pages" && path[3]) {
          const page = detail.pages.find((p) => p.id === path[3]);
          if (!page) throw new AppError(404, "Page not found.");
          return Response.json(page);
        }
        if (!action)
          return Response.json({
            ...detail,
            pages: detail.pages.map((p) => ({ ...p, markdown: "" })),
          });
      }
      if (action === "retry" && request.method === "POST")
        return Response.json(await service.retry(id), { status: 201 });
    }
    if (section === "worker" && request.method === "POST") {
      if (id === "claim") return Response.json(await service.claim());
      const data = await body(request);
      if (id === "progress") return Response.json(await service.progress(data));
      if (id === "heartbeat")
        return Response.json(await service.heartbeat(data));
      if (id === "page") return Response.json(await service.upload(data));
      if (id === "finish") return Response.json(await service.finish(data));
    }
    throw new AppError(404, "Route not found.");
  } catch (e) {
    if (e instanceof ZodError)
      return Response.json(
        { error: e.issues.map((i) => i.message).join(" ") },
        { status: 400 },
      );
    if (e instanceof AppError)
      return Response.json({ error: e.message }, { status: e.status });
    console.error(
      "API operation failed",
      e instanceof Error ? e.name : "UnknownError",
    );
    return Response.json(
      { error: "The operation failed. Check the server setup or retry later." },
      { status: 500 },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
