import { randomUUID } from "node:crypto";
import type { Database, Query } from "./db";
import {
  AppError,
  createRunSchema,
  pageSchema,
  leaseSchema,
  folderSchema,
  folderUpdateSchema,
  folderMoveSchema,
  runIdsSchema,
  moveRunsSchema,
} from "./validation";
import type { Run, Page, RunDetail, SystemStatus, Folder } from "./types";
const nameTaken = (e: unknown) =>
  !!e && typeof e === "object" && (e as { code?: string }).code === "23505";
import { z } from "zod";
export class CrawlerService {
  constructor(private db: Database) {}
  private async lock(q: Query) {
    await q.query("SELECT id FROM worker_state WHERE id=1 FOR UPDATE");
  }
  private async recover(q: Query) {
    await q.query(
      "UPDATE runs SET status='interrupted', finished_at=now(), error='Worker lease expired. Retry to continue in a new run.',lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<=now()",
    );
    await q.query(
      "UPDATE worker_state SET active_run=NULL WHERE active_run IN (SELECT id FROM runs WHERE status<>'running')",
    );
  }
  private async storage(q: Query) {
    const r = await q.query<{ bytes: string }>(
      "SELECT pg_database_size(current_database())::text AS bytes",
    );
    return Number(r.rows[0].bytes);
  }
  async create(input: unknown, retryOf: string | null = null) {
    const data = createRunSchema.parse(input);
    return this.db.transaction(async (q) => {
      await this.lock(q);
      if (data.folder_id) await this.folderExists(q, data.folder_id, 400);
      const id = randomUUID();
      const r = await q.query<Run>(
        `INSERT INTO runs(id,title,description,urls,mode,fetch_mode,retry_of,folder_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8) RETURNING *`,
        [
          id,
          data.title || new URL(data.urls[0]).hostname,
          data.description,
          JSON.stringify(data.urls),
          data.mode,
          data.fetch_mode,
          retryOf,
          data.folder_id,
        ],
      );
      return this.clean(r.rows[0]);
    });
  }
  private clean(run: Run & { lease_token?: unknown; lease_until?: unknown }) {
    const { lease_token: _, lease_until: __, ...rest } = run;
    return rest as Run;
  }
  async list(params: URLSearchParams) {
    await this.db.transaction(async (q) => {
      await this.lock(q);
      await this.recover(q);
    });
    const search = (params.get("q") || "").slice(0, 200);
    const status = params.get("status") || "";
    const date = params.get("date") || "";
    const folder = params.get("folder") || "";
    if (folder && folder !== "root" && !z.uuid().safeParse(folder).success)
      throw new AppError(400, "Unknown folder.");
    if (date && !z.iso.date().safeParse(date).success)
      throw new AppError(400, "Use a valid date.");
    const page = Math.max(
      1,
      Math.min(10000, Math.floor(Number(params.get("page")) || 1)),
    );
    const r = await this.db.query<Run>(
      `SELECT r.*, (SELECT count(*)::int FROM pages p WHERE p.run_id=r.id) page_count, (SELECT count(*)::int FROM pages p WHERE p.run_id=r.id AND p.status='success') success_count FROM runs r WHERE ($1='' OR r.title ILIKE '%'||$1||'%' OR r.description ILIKE '%'||$1||'%' OR r.urls::text ILIKE '%'||$1||'%' OR EXISTS(SELECT 1 FROM pages p WHERE p.run_id=r.id AND (p.url ILIKE '%'||$1||'%' OR p.final_url ILIKE '%'||$1||'%'))) AND ($2='' OR r.status=$2) AND ($3='' OR (r.created_at AT TIME ZONE 'Asia/Calcutta')::date = NULLIF($3,'')::date) AND ($5='' OR ($5='root' AND r.folder_id IS NULL) OR r.folder_id::text=$5) ORDER BY r.created_at DESC,r.id LIMIT 31 OFFSET $4`,
      [search, status, date, (page - 1) * 30, folder],
    );
    return {
      runs: r.rows.slice(0, 30).map((v) => this.clean(v)),
      has_more: r.rows.length > 30,
      page,
    };
  }
  async detail(id: string): Promise<RunDetail> {
    z.uuid().parse(id);
    await this.db.transaction(async (q) => {
      await this.lock(q);
      await this.recover(q);
    });
    const r = await this.db.query<Run>("SELECT * FROM runs WHERE id=$1", [id]);
    if (!r.rows[0]) throw new AppError(404, "Run not found.");
    const pages = await this.db.query<Page>(
      "SELECT * FROM pages WHERE run_id=$1 ORDER BY collected_at,id",
      [id],
    );
    return { run: this.clean(r.rows[0]), pages: pages.rows };
  }
  async system(): Promise<SystemStatus> {
    const w = await this.db.query<{ last_seen: string | null }>(
      "SELECT last_seen FROM worker_state WHERE id=1",
    );
    const last = w.rows[0]?.last_seen;
    return {
      last_seen: last,
      online: !!last && Date.now() - new Date(last).getTime() < 90000,
      storage_bytes: await this.storage(this.db),
    };
  }
  async retry(id: string) {
    const { run, pages } = await this.detail(id);
    if (["queued", "running"].includes(run.status))
      throw new AppError(409, "Wait for this run to stop.");
    const failures = pages
      .filter((p) => p.status !== "success")
      .map((p) => p.url);
    const done = new Set(
      pages.filter((p) => p.status === "success").map((p) => p.url),
    );
    const pending = run.urls.filter((url) => !done.has(url));
    const urls = [...new Set([...failures, ...pending])].slice(0, 25);
    if (!urls.length)
      throw new AppError(409, "This run has no failed or pending pages.");
    return this.create(
      {
        ...run,
        title: `Retry: ${run.title}`.slice(0, 160),
        urls,
        mode: run.mode === "crawl" && failures.length === 0 ? "crawl" : "pages",
      },
      id,
    );
  }
  async claim() {
    return this.db.transaction(async (q) => {
      await this.lock(q);
      await this.recover(q);
      await q.query("UPDATE worker_state SET last_seen=now() WHERE id=1");
      const active = await q.query(
        "SELECT id FROM runs WHERE status='running' LIMIT 1",
      );
      if (active.rows.length) return { job: null };
      const next = await q.query<Run>(
        "SELECT * FROM runs WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (!next.rows[0]) return { job: null };
      const token = randomUUID();
      const r = await q.query<Run>(
        "UPDATE runs SET status='running', started_at=now(),lease_token=$2,lease_until=now()+interval '120 seconds' WHERE id=$1 RETURNING *",
        [next.rows[0].id, token],
      );
      await q.query("UPDATE worker_state SET active_run=$1 WHERE id=1", [
        r.rows[0].id,
      ]);
      return { job: { ...this.clean(r.rows[0]), lease_token: token } };
    });
  }
  private async lease(q: Query, input: unknown) {
    const v = leaseSchema.parse(input);
    await this.lock(q);
    const r = await q.query<Run>(
      "SELECT * FROM runs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",
      [v.run_id, v.lease_token],
    );
    if (!r.rows[0])
      throw new AppError(
        409,
        "Lease expired. Preserve local output and retry from History.",
      );
    return r.rows[0];
  }
  async progress(input: unknown) {
    const data = leaseSchema
      .extend({
        seq: z.number().int().min(1).max(2147483647),
        stage: z.enum([
          "fetching",
          "cleaning",
          "saving",
          "retrying",
          "pageComplete",
          "failed",
        ]),
        url: z.string().url().max(8000),
      })
      .parse(input);
    return this.db.transaction(async (q) => {
      const run = await this.lease(q, data);
      if (
        new URL(data.url).host !== new URL(run.urls[0]).host &&
        !run.urls.includes(data.url)
      )
        throw new AppError(400, "Source outside this run.");
      await q.query(
        "UPDATE runs SET progress=$2::jsonb,progress_seq=$3 WHERE id=$1 AND progress_seq<$3",
        [
          run.id,
          JSON.stringify({ stage: data.stage, url: data.url }),
          data.seq,
        ],
      );
      await q.query("UPDATE worker_state SET last_seen=now() WHERE id=1");
      return { ok: true };
    });
  }
  async heartbeat(input: unknown) {
    return this.db.transaction(async (q) => {
      const r = await this.lease(q, input);
      await q.query(
        "UPDATE runs SET lease_until=now()+interval '120 seconds' WHERE id=$1",
        [r.id],
      );
      await q.query("UPDATE worker_state SET last_seen=now() WHERE id=1");
      return { ok: true };
    });
  }
  async upload(input: unknown) {
    const parsed = leaseSchema.extend({ page: pageSchema }).parse(input);
    return this.db.transaction(async (q) => {
      const run = await this.lease(q, parsed);
      let p = parsed.page;
      const existing = await q.query<Page>(
        "SELECT * FROM pages WHERE run_id=$1 AND (url=$2 OR id=$3)",
        [run.id, p.url, p.id],
      );
      if (existing.rows.length) return { ok: true, duplicate: true };
      const count = await q.query<{ n: number }>(
        "SELECT count(*)::int n FROM pages WHERE run_id=$1",
        [run.id],
      );
      if (count.rows[0].n >= 25)
        throw new AppError(409, "Run reached its page limit.");
      if (run.mode === "pages" && !run.urls.includes(p.url))
        throw new AppError(400, "Page is not in this run.");
      if (
        run.mode === "crawl" &&
        new URL(p.url).host !== new URL(run.urls[0]).host
      )
        throw new AppError(400, "Page is outside the crawl host.");
      const bytes = Buffer.byteLength(p.markdown);
      if (run.byte_count + bytes > 10000000)
        p = {
          ...p,
          markdown: "",
          status: "limit",
          error: "Run exceeded 10 MB.",
        };
      await q.query(
        "INSERT INTO pages(id,run_id,url,final_url,parent_url,title,status,error,markdown,collected_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          p.id,
          run.id,
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
      await q.query("UPDATE runs SET byte_count=byte_count+$2 WHERE id=$1", [
        run.id,
        Buffer.byteLength(p.markdown),
      ]);
      return { ok: true, duplicate: false };
    });
  }
  async finish(input: unknown) {
    const data = leaseSchema
      .extend({ error: z.string().max(2000).optional() })
      .parse(input);
    return this.db.transaction(async (q) => {
      const r = await this.lease(q, data);
      const p = await q.query<Page>(
        "SELECT status,url FROM pages WHERE run_id=$1",
        [r.id],
      );
      const successes = p.rows.filter((x) => x.status === "success").length;
      const missing = r.urls.some((url) => !p.rows.some((x) => x.url === url));
      const failed =
        p.rows.some((x) => x.status !== "success") || !!data.error || missing;
      const status = successes ? (failed ? "partial" : "completed") : "failed";
      await q.query(
        "UPDATE runs SET status=$2,finished_at=now(),error=$3,lease_token=NULL,lease_until=NULL WHERE id=$1",
        [
          r.id,
          status,
          data.error ||
            (missing ? "Some supplied pages were not processed." : null),
        ],
      );
      await q.query(
        "UPDATE worker_state SET last_seen=now(),active_run=NULL WHERE id=1",
      );
      return { ok: true, status };
    });
  }
  private async folderExists(q: Query, id: string, status = 404) {
    const r = await q.query<Folder>("SELECT * FROM folders WHERE id=$1", [id]);
    if (!r.rows[0]) throw new AppError(status, "Folder not found.");
    return r.rows[0];
  }
  /** Folders plus a light index of runs (newest 2000) for the History tree. */
  async folders() {
    const f = await this.db.query<Folder>(
      "SELECT f.*, (SELECT count(*)::int FROM runs r WHERE r.folder_id=f.id) run_count FROM folders f ORDER BY f.position,lower(f.name),f.id",
    );
    const r = await this.db.query<
      Pick<Run, "id" | "title" | "status" | "folder_id" | "created_at">
    >(
      "SELECT id,title,status,folder_id,created_at FROM runs ORDER BY created_at DESC,id LIMIT 2000",
    );
    return { folders: f.rows, runs: r.rows };
  }
  async createFolder(input: unknown): Promise<Folder> {
    const data = folderSchema.parse(input);
    try {
      return await this.db.transaction(async (q) => {
        if (data.parent_id) await this.folderExists(q, data.parent_id, 400);
        // New folders go to the end of their siblings.
        const r = await q.query<Folder>(
          "INSERT INTO folders(id,name,parent_id,position) VALUES($1,$2,$3,(SELECT COALESCE(max(position)+1,0) FROM folders WHERE parent_id IS NOT DISTINCT FROM $3::uuid)) RETURNING *",
          [randomUUID(), data.name, data.parent_id],
        );
        return r.rows[0];
      });
    } catch (e) {
      if (nameTaken(e))
        throw new AppError(409, "A folder with that name already exists here.");
      throw e;
    }
  }
  async updateFolder(id: string, input: unknown): Promise<Folder> {
    z.uuid().parse(id);
    const data = folderUpdateSchema.parse(input);
    try {
      return await this.db.transaction(async (q) => {
        const folder = await this.folderExists(q, id);
        const parent =
          data.parent_id === undefined ? folder.parent_id : data.parent_id;
        if (parent) {
          await this.folderExists(q, parent, 400);
          const loop = await q.query(
            "WITH RECURSIVE up(id,parent_id) AS (SELECT id,parent_id FROM folders WHERE id=$1 UNION ALL SELECT f.id,f.parent_id FROM folders f JOIN up ON f.id=up.parent_id) SELECT 1 FROM up WHERE id=$2 LIMIT 1",
            [parent, id],
          );
          if (loop.rows.length)
            throw new AppError(400, "A folder cannot go inside itself.");
        }
        const r = await q.query<Folder>(
          "UPDATE folders SET name=$2,parent_id=$3 WHERE id=$1 RETURNING *",
          [id, data.name ?? folder.name, parent],
        );
        return r.rows[0];
      });
    } catch (e) {
      if (nameTaken(e))
        throw new AppError(409, "A folder with that name already exists here.");
      throw e;
    }
  }
  /**
   * Places a folder among its siblings: under `parent_id`, before `before_id`
   * or after `after_id` (otherwise last). Siblings are renumbered 0..n in the
   * order shown, so manual order survives reloads.
   */
  async moveFolder(id: string, input: unknown): Promise<Folder> {
    z.uuid().parse(id);
    const data = folderMoveSchema.parse(input);
    try {
      return await this.db.transaction(async (q) => {
        await this.folderExists(q, id);
        if (data.parent_id) {
          await this.folderExists(q, data.parent_id, 400);
          const loop = await q.query(
            "WITH RECURSIVE up(id,parent_id) AS (SELECT id,parent_id FROM folders WHERE id=$1 UNION ALL SELECT f.id,f.parent_id FROM folders f JOIN up ON f.id=up.parent_id) SELECT 1 FROM up WHERE id=$2 LIMIT 1",
            [data.parent_id, id],
          );
          if (loop.rows.length)
            throw new AppError(400, "A folder cannot go inside itself.");
        }
        await q.query("UPDATE folders SET parent_id=$2 WHERE id=$1", [
          id,
          data.parent_id,
        ]);
        const siblings = (
          await q.query<{ id: string }>(
            "SELECT id FROM folders WHERE parent_id IS NOT DISTINCT FROM $1::uuid AND id<>$2 ORDER BY position,lower(name),id",
            [data.parent_id, id],
          )
        ).rows.map((r) => r.id);
        const anchor = data.before_id ?? data.after_id;
        let at = anchor ? siblings.indexOf(anchor) : -1;
        if (anchor && at < 0)
          throw new AppError(400, "That folder is not in the target folder.");
        if (at < 0) at = siblings.length;
        else if (data.after_id) at += 1;
        siblings.splice(at, 0, id);
        await q.query(
          "UPDATE folders f SET position=o.n FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id,n) WHERE f.id=o.id",
          [siblings],
        );
        return (
          await q.query<Folder>("SELECT * FROM folders WHERE id=$1", [id])
        ).rows[0];
      });
    } catch (e) {
      if (nameTaken(e))
        throw new AppError(
          409,
          "A folder with that name already exists there.",
        );
      throw e;
    }
  }
  /** Removes only the folder; its runs and subfolders move up to its parent. */
  async deleteFolder(id: string) {
    z.uuid().parse(id);
    try {
      return await this.db.transaction(async (q) => {
        const folder = await this.folderExists(q, id);
        await q.query("UPDATE runs SET folder_id=$2 WHERE folder_id=$1", [
          id,
          folder.parent_id,
        ]);
        await q.query("UPDATE folders SET parent_id=$2 WHERE parent_id=$1", [
          id,
          folder.parent_id,
        ]);
        await q.query("DELETE FROM folders WHERE id=$1", [id]);
        return { deleted: id };
      });
    } catch (e) {
      if (nameTaken(e))
        throw new AppError(
          409,
          "A subfolder has the same name as a folder in the parent. Rename it first.",
        );
      throw e;
    }
  }
  async moveRuns(input: unknown) {
    const data = moveRunsSchema.parse(input);
    return this.db.transaction(async (q) => {
      if (data.folder_id) await this.folderExists(q, data.folder_id, 400);
      const r = await q.query(
        "UPDATE runs SET folder_id=$2 WHERE id = ANY($1::uuid[]) RETURNING id",
        [data.ids, data.folder_id],
      );
      return { moved: r.rows.length };
    });
  }
  /** Owner-confirmed permanent delete of runs and their pages. */
  async deleteRuns(input: unknown) {
    const { ids } = runIdsSchema.parse(input);
    return this.db.transaction(async (q) => {
      await this.lock(q);
      await this.recover(q);
      const busy = await q.query(
        "SELECT 1 FROM runs WHERE id = ANY($1::uuid[]) AND status='running' LIMIT 1",
        [ids],
      );
      if (busy.rows.length)
        throw new AppError(
          409,
          "A run is still collecting. Wait for it to stop, then delete it.",
        );
      await q.query(
        "UPDATE runs SET retry_of=NULL WHERE retry_of = ANY($1::uuid[])",
        [ids],
      );
      await q.query("DELETE FROM pages WHERE run_id = ANY($1::uuid[])", [ids]);
      const r = await q.query(
        "DELETE FROM runs WHERE id = ANY($1::uuid[]) RETURNING id",
        [ids],
      );
      return { deleted: r.rows.length };
    });
  }
}
