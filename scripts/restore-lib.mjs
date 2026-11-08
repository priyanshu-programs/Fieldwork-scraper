import { z } from "zod";
const runSchema = z.object({
  id: z.uuid(),
  title: z.string().max(160),
  description: z.string().max(4000),
  urls: z.array(z.url()).min(1).max(25),
  mode: z.enum(["pages", "crawl"]),
  fetch_mode: z.enum(["http", "browser"]),
  status: z.enum([
    "queued",
    "running",
    "completed",
    "partial",
    "failed",
    "interrupted",
  ]),
  created_at: z.coerce.date(),
  started_at: z.coerce.date().nullable(),
  finished_at: z.coerce.date().nullable(),
  error: z.string().nullable(),
});
const pageSchema = z.object({
  id: z.uuid(),
  run_id: z.uuid(),
  url: z.url(),
  final_url: z.url().nullable(),
  parent_url: z.url().nullable(),
  title: z.string().max(500),
  status: z.enum(["success", "failed", "blocked", "unsupported", "limit"]),
  error: z.string().nullable(),
  markdown: z.string().refine((v) => Buffer.byteLength(v) <= 500000),
  collected_at: z.coerce.date(),
});
export async function restoreRun(query, data) {
  const backup = z
    .object({
      format: z.literal("research-crawler/v1"),
      run: runSchema,
      pages: z.array(pageSchema).max(25),
    })
    .parse(data);
  if (backup.pages.some((p) => p.run_id !== backup.run.id))
    throw Error("Backup contains mismatched run IDs");
  const r = backup.run;
  const bytes = backup.pages.reduce(
    (s, p) => s + Buffer.byteLength(p.markdown),
    0,
  );
  if (bytes > 10000000) throw Error("Backup exceeds run limit");
  const status = ["queued", "running"].includes(r.status)
    ? "interrupted"
    : r.status;
  await query.query(
    "INSERT INTO runs(id,title,description,urls,mode,fetch_mode,status,created_at,started_at,finished_at,error,byte_count) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)",
    [
      r.id,
      r.title,
      r.description,
      JSON.stringify(r.urls),
      r.mode,
      r.fetch_mode,
      status,
      r.created_at,
      r.started_at,
      r.finished_at,
      r.error,
      bytes,
    ],
  );
  for (const p of backup.pages)
    await query.query(
      "INSERT INTO pages(id,run_id,url,final_url,parent_url,title,status,error,markdown,collected_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        p.id,
        p.run_id,
        p.url,
        p.final_url,
        p.parent_url,
        p.title,
        p.status,
        p.error,
        p.markdown,
        p.collected_at,
      ],
    );
  return r.id;
}
