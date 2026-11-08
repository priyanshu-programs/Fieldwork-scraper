"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import type { Run, RunDetail, SystemStatus, Page, Folder } from "@/lib/types";
import { pageMarkdown } from "@/lib/export";
import CollectorPanel from "./collector/panel";
import { acceptSnapshot } from "./collector/model";
import RunTree, {
  ConfirmPanel,
  FolderOptions,
  folderPath,
  type Confirmation,
  type RunEntry,
  RUN_DRAG,
} from "./run-tree";
const FOLDER_KEY = "fieldwork.collect.folder";
const when = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Calcutta",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(date)) + " IST"
    : ":";
const size = (n: number) =>
  n >= 1000000
    ? `${(n / 1000000).toFixed(1)} MB`
    : `${(n / 1000).toFixed(1)} KB`;
async function api(path: string, init?: RequestInit) {
  const res = await fetch("/api/" + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Request failed.");
  return data;
}
export default function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const history = params.get("view") === "history";
  const selected = params.get("run");
  const folder = params.get("folder") || "";
  const [liveRun, setLiveRun] = useState<Run | null>(null);
  const [retryPreserved, setRetryPreserved] = useState(0);
  const requestVersion = useRef(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [pageId, setPageId] = useState("");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState("pages");
  const [urls, setUrls] = useState("");
  const [content, setContent] = useState<Page | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [index, setIndex] = useState<RunEntry[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [collectFolder, setCollectFolder] = useState("");
  useEffect(() => {
    try {
      setCollectFolder(localStorage.getItem(FOLDER_KEY) || "");
    } catch {}
  }, []);
  const query = params.toString();
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const [list, state, tree] = await Promise.all([
        api("runs?" + query),
        api("system"),
        api("folders"),
      ]);
      if (version !== requestVersion.current) return;
      setRuns(list.runs);
      setFolders(tree.folders ?? []);
      setIndex(tree.runs ?? []);
      setPicked((prev) => {
        const ids = new Set(list.runs.map((r: Run) => r.id));
        const next = new Set([...prev].filter((id) => ids.has(id)));
        return next.size === prev.size ? prev : next;
      });
      if (!liveRun) {
        const active = list.runs.find((r: Run) =>
          ["queued", "running"].includes(r.status),
        );
        if (active) setLiveRun(active);
      }
      setHasMore(list.has_more);
      setSystem(state);
      if (liveRun) {
        const snapshot = await api("runs/" + liveRun.id);
        if (version !== requestVersion.current) return;
        const success_count = snapshot.pages.filter(
          (p: Page) => p.status === "success",
        ).length;
        setLiveRun((previous) =>
          acceptSnapshot(previous, {
            ...snapshot.run,
            page_count: snapshot.pages.length,
            success_count,
            error:
              snapshot.run.error ||
              snapshot.pages.find((p: Page) => p.error)?.error ||
              null,
          }),
        );
      }
      if (selected) {
        const nextDetail = await api("runs/" + selected);
        if (version !== requestVersion.current) return;
        setDetail(nextDetail);
      } else setDetail(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load records.");
    } finally {
      setLoading(false);
    }
  }, [query, selected, liveRun?.id]);
  useEffect(() => {
    setLoading(true);
    setPageId("");
    void refresh();
    const timer = setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      liveRun && ["queued", "running"].includes(liveRun.status) ? 1500 : 15000,
    );
    return () => {
      clearInterval(timer);
      requestVersion.current++;
    };
  }, [refresh, liveRun?.status]);
  const activePage = pageId || detail?.pages[0]?.id;
  useEffect(() => {
    let cancelled = false;
    setContent(null);
    if (selected && activePage)
      api(`runs/${selected}/pages/${activePage}`)
        .then((p) => {
          if (!cancelled) setContent(p);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [selected, activePage]);
  function navigate(values: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) v ? p.set(k, v) : p.delete(k);
    router.push(pathname + "?" + p.toString());
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const run = await api("runs", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          urls: urls
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean),
          mode,
          fetch_mode: form.get("fetch_mode"),
          folder_id:
            collectFolder && folders.some((f) => f.id === collectFolder)
              ? collectFolder
              : null,
        }),
      });
      setRetryPreserved(0);
      setLiveRun(run);
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function askDeleteRuns(ids: string[], label: string) {
    setConfirm({
      title:
        ids.length === 1 ? `Delete ${label}?` : `Delete ${ids.length} runs?`,
      body: "The run and every page saved in it are removed permanently. Download Markdown or JSON first if you may need them.",
      action: ids.length === 1 ? "Delete run" : `Delete ${ids.length} runs`,
      run: async () => {
        try {
          await api("runs/delete", {
            method: "POST",
            body: JSON.stringify({ ids }),
          });
          setConfirm(null);
          setPicked(new Set());
          if (liveRun && ids.includes(liveRun.id)) setLiveRun(null);
          if (selected && ids.includes(selected)) navigate({ run: "" });
          else void refresh();
        } catch (e) {
          setConfirm(null);
          setError((e as Error).message);
        }
      },
    });
  }
  async function moveRuns(ids: string[], target: string) {
    try {
      await api("runs/move", {
        method: "POST",
        body: JSON.stringify({ ids, folder_id: target || null }),
      });
      setPicked(new Set());
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function retry() {
    if (!detail) return;
    setBusy(true);
    try {
      const run = await api(`runs/${detail.run.id}/retry`, { method: "POST" });
      setRetryPreserved(
        detail.pages.filter((p) => p.status === "success").length,
      );
      setLiveRun(run);
      navigate({ view: "", run: "" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const page = content;
  const pickedRunning = runs.some(
    (r) => picked.has(r.id) && r.status === "running",
  );
  const count = urls.split(/\r?\n/).filter((x) => x.trim()).length;
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link href="/" className="wordmark">
            <span className="mark" aria-hidden="true">
              ///
            </span>
            Fieldwork
          </Link>
          <nav aria-label="Main">
            <Link href="/" aria-current={!history ? "page" : undefined}>
              Collect
            </Link>
            <Link
              href="/?view=history"
              aria-current={history ? "page" : undefined}
            >
              History
            </Link>
          </nav>
          <div className="account">
            <span className="muted small">On this computer</span>
          </div>
        </div>
      </header>
      <main id="main" className="container workspace">
        <div className="workspace-heading">
          <div>
            <h1>
              {history
                ? selected
                  ? "Run detail"
                  : "Collection history"
                : "Keep what you find."}
            </h1>
            <p>
              {history
                ? "The request, the source, and the result. All in one place."
                : "Give it a link. Get the page. Keep the source."}
            </p>
          </div>
          <div className="worker-state" role="status">
            <span className={system?.online ? "live" : ""}>
              {system?.online ? "Worker connected" : "Worker offline"}
            </span>
            <small>
              {system?.last_seen
                ? "Last contact " + when(system.last_seen)
                : "Runs wait here until your worker connects."}
            </small>
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}{" "}
            <button className="text-button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}
        {!history ? (
          <>
            <div className="collect-grid">
              <section className="collection-panel">
                <div className="panel-heading">
                  <h2>New collection</h2>
                  <span className="muted small">Markdown + JSON</span>
                </div>
                <form onSubmit={submit}>
                  <fieldset disabled={busy} className="form-fields">
                    <div className="field">
                      <label htmlFor="urls">
                        Source links{" "}
                        <span>
                          {count} / {mode === "crawl" ? "1" : "25"}
                        </span>
                      </label>
                      <textarea
                        id="urls"
                        name="urls"
                        rows={6}
                        required
                        value={urls}
                        onChange={(e) => setUrls(e.target.value)}
                        placeholder="https://example.com/article&#10;https://example.com/about"
                        aria-describedby="url-help"
                      />
                      <small id="url-help">
                        One public URL per line. No account or payment pages.
                      </small>
                    </div>
                    <div className="field">
                      <label htmlFor="title">
                        Collection name <span>Optional</span>
                      </label>
                      <input
                        id="title"
                        name="title"
                        maxLength={160}
                        placeholder="A name to find this later"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="description">
                        What are you collecting? <span>Optional</span>
                      </label>
                      <textarea
                        id="description"
                        name="description"
                        rows={2}
                        maxLength={4000}
                        placeholder="A short note for your future self"
                      />
                      <small>
                        Saved with the run. This does not ask an AI to analyse
                        the page.
                      </small>
                    </div>
                    <div className="options">
                      <div className="field">
                        <label htmlFor="mode">Collection scope</label>
                        <select
                          id="mode"
                          value={mode}
                          onChange={(e) => setMode(e.target.value)}
                        >
                          <option value="pages">Only these pages</option>
                          <option value="crawl">
                            Follow links on this site
                          </option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="fetch_mode">Page loader</label>
                        <select id="fetch_mode" name="fetch_mode">
                          <option value="http">HTTP : standard pages</option>
                          <option value="browser">
                            Browser : JavaScript pages
                          </option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="folder_id">Folder</label>
                        <select
                          id="folder_id"
                          value={
                            folders.some((f) => f.id === collectFolder)
                              ? collectFolder
                              : ""
                          }
                          onChange={(e) => {
                            setCollectFolder(e.target.value);
                            try {
                              localStorage.setItem(FOLDER_KEY, e.target.value);
                            } catch {}
                          }}
                        >
                          <FolderOptions folders={folders} />
                        </select>
                      </div>
                    </div>
                    {mode === "crawl" && (
                      <p className="small muted">
                        One starting URL. Same host. Up to 25 pages and 2 link
                        levels.
                      </p>
                    )}
                    <div className="submit-row">
                      <button
                        className="primary"
                        type="submit"
                        aria-busy={busy}
                      >
                        {busy ? "Adding to queue…" : "Start collection"}
                        <span aria-hidden="true">＋</span>
                      </button>
                      <span className="muted small">
                        No AI processing. Just the source.
                      </span>
                    </div>
                  </fieldset>
                </form>
              </section>
              <aside className="side-notes">
                <div className="collector-panel-frame">
                  {liveRun || busy ? (
                    <CollectorPanel
                      run={liveRun}
                      system={system}
                      submitting={busy}
                      preserved={retryPreserved}
                    />
                  ) : (
                    <section className="ticks">
                      <h2>
                        From page
                        <br /> to working material.
                      </h2>
                      <p>
                        Readable content, ready for whichever model you choose.
                      </p>
                      <ol className="process">
                        <li>
                          <strong>Add your links</strong>
                          <span>Collect a page or follow a small trail.</span>
                        </li>
                        <li>
                          <strong>Let the worker collect</strong>
                          <span>Your computer handles the web requests.</span>
                        </li>
                        <li>
                          <strong>Take the output</strong>
                          <span>Copy Markdown or download the full run.</span>
                        </li>
                      </ol>
                    </section>
                  )}
                </div>
                <div className="limits">
                  <h3>Small by design</h3>
                  <dl>
                    <div>
                      <dt>Pages per run</dt>
                      <dd>25 maximum</dd>
                    </div>
                    <div>
                      <dt>Markdown per page</dt>
                      <dd>500 KB</dd>
                    </div>
                    <div>
                      <dt>Content per run</dt>
                      <dd>10 MB</dd>
                    </div>
                  </dl>
                  <p className="small muted">
                    Every run keeps its own date, links and results. A new run
                    never replaces an old one.
                  </p>
                </div>
              </aside>
            </div>
            <section className="recent">
              <div className="panel-heading">
                <h2>Recent collections</h2>
                <Link href="/?view=history">Open history</Link>
              </div>
              <RunTable runs={runs.slice(0, 5)} loading={loading} />
            </section>
          </>
        ) : (
          <div className="history-layout">
            <aside aria-label="Folders">
              <RunTree
                folders={folders}
                runs={index}
                folder={folder}
                run={selected}
                api={api}
                onNavigate={navigate}
                onChanged={() => void refresh()}
                onError={setError}
                onDeleteRuns={askDeleteRuns}
                onMoveRuns={(ids, target) => void moveRuns(ids, target ?? "")}
                onConfirm={(c) =>
                  setConfirm({
                    ...c,
                    run: async () => {
                      try {
                        await c.run();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                      setConfirm(null);
                    },
                  })
                }
              />
            </aside>
            <div className="history-main">
              <ConfirmPanel
                confirm={confirm}
                onCancel={() => setConfirm(null)}
              />
              <form
                className="filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  navigate({
                    view: "history",
                    q: String(f.get("q") || ""),
                    status: String(f.get("status") || ""),
                    date: String(f.get("date") || ""),
                    page: "",
                    run: "",
                    folder,
                  });
                }}
              >
                <div className="field">
                  <label htmlFor="q">Find a collection</label>
                  <input
                    key={params.get("q")}
                    id="q"
                    name="q"
                    defaultValue={params.get("q") || ""}
                    placeholder="Name, note or URL"
                  />
                </div>
                <div className="field">
                  <label htmlFor="status">Status</label>
                  <select
                    key={params.get("status")}
                    id="status"
                    name="status"
                    defaultValue={params.get("status") || ""}
                  >
                    <option value="">All statuses</option>
                    {[
                      "queued",
                      "running",
                      "completed",
                      "partial",
                      "failed",
                      "interrupted",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="date">Date (IST)</label>
                  <input
                    key={params.get("date")}
                    type="date"
                    id="date"
                    name="date"
                    defaultValue={params.get("date") || ""}
                  />
                </div>
                <button type="submit" className="secondary">
                  Filter
                </button>
              </form>
              {selected && detail ? (
                <section className="detail">
                  <div className="detail-head">
                    <div>
                      <button
                        className="text-button back-link"
                        onClick={() => navigate({ run: "" })}
                      >
                        Back to{" "}
                        {folder === "root"
                          ? "Unfiled"
                          : folder
                            ? folderPath(folders, folder) || "history"
                            : "history"}
                      </button>
                      <h2>{detail.run.title}</h2>
                      <p>{detail.run.description || "No description added."}</p>
                      <span className={"status " + detail.run.status}>
                        {detail.run.status}
                      </span>
                    </div>
                    <div className="export-actions">
                      <a
                        className="secondary"
                        href={`/api/runs/${selected}/export`}
                      >
                        Download Markdown
                      </a>
                      <a
                        className="secondary"
                        href={`/api/runs/${selected}/export?format=json`}
                      >
                        Download JSON
                      </a>
                      {!["queued", "running", "completed"].includes(
                        detail.run.status,
                      ) &&
                        (detail.pages.some((p) => p.status !== "success") ||
                          detail.run.urls.some(
                            (url) =>
                              !detail.pages.some(
                                (p) => p.url === url && p.status === "success",
                              ),
                          )) && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={retry}
                          >
                            Retry failed pages
                          </button>
                        )}
                      <label className="inline-select">
                        <span>Folder</span>
                        <select
                          value={detail.run.folder_id || ""}
                          onChange={(e) =>
                            void moveRuns([detail.run.id], e.target.value)
                          }
                        >
                          <FolderOptions folders={folders} />
                        </select>
                      </label>
                      <button
                        className="secondary danger-text"
                        disabled={detail.run.status === "running"}
                        title={
                          detail.run.status === "running"
                            ? "Wait for the run to stop before deleting it."
                            : undefined
                        }
                        onClick={() =>
                          askDeleteRuns(
                            [detail.run.id],
                            `“${detail.run.title}”`,
                          )
                        }
                      >
                        Delete run
                      </button>
                    </div>
                  </div>
                  <dl className="run-meta">
                    <div>
                      <dt>Requested</dt>
                      <dd>{when(detail.run.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Finished</dt>
                      <dd>{when(detail.run.finished_at)}</dd>
                    </div>
                    <div>
                      <dt>Mode</dt>
                      <dd>
                        {detail.run.mode} / {detail.run.fetch_mode}
                      </dd>
                    </div>
                    <div>
                      <dt>Saved content</dt>
                      <dd>{size(detail.run.byte_count)}</dd>
                    </div>
                  </dl>
                  <details className="sources">
                    <summary>
                      Submitted links ({detail.run.urls.length})
                    </summary>
                    <ul>
                      {detail.run.urls.map((url) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noreferrer">
                            {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                  {detail.run.error && (
                    <p className="notice">{detail.run.error}</p>
                  )}
                  {detail.pages.length ? (
                    <div className="reader-grid">
                      <div className="page-list" aria-label="Collected pages">
                        {detail.pages.map((p) => (
                          <button
                            key={p.id}
                            className={
                              page?.id === p.id
                                ? "page-item selected"
                                : "page-item"
                            }
                            onClick={() => {
                              setPageId(p.id);
                              setCopied(false);
                            }}
                          >
                            <strong>
                              {p.title || new URL(p.url).pathname}
                            </strong>
                            <small>{new URL(p.url).hostname}</small>
                            <span className={"status " + p.status}>
                              {p.status}
                            </span>
                          </button>
                        ))}
                      </div>
                      <article className="reader">
                        {page ? (
                          <>
                            <div className="reader-toolbar">
                              <a
                                href={page.final_url || page.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open source
                              </a>
                              <button
                                className="text-button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(
                                      pageMarkdown(page),
                                    );
                                    setCopied(true);
                                  } catch {
                                    setError(
                                      "Clipboard unavailable. Use Download instead.",
                                    );
                                  }
                                }}
                              >
                                {copied ? "Copied" : "Copy page"}
                              </button>
                              <a
                                href={`/api/runs/${selected}/export?page=${page.id}`}
                              >
                                Download page
                              </a>
                            </div>
                            <p className="small muted">
                              Collected {when(page.collected_at)}
                            </p>
                            {page.error && (
                              <p role="status" className="notice">
                                {page.error}
                              </p>
                            )}
                            <div className="markdown">
                              <ReactMarkdown
                                components={{
                                  a: (props) => (
                                    <a
                                      {...props}
                                      target="_blank"
                                      rel="noreferrer"
                                    />
                                  ),
                                  img: () => <span>[Image omitted]</span>,
                                }}
                              >
                                {page.markdown || "No page content saved."}
                              </ReactMarkdown>
                            </div>
                          </>
                        ) : (
                          <p role="status">
                            {error
                              ? "Page could not be loaded. Use Try again above."
                              : "Loading page content…"}
                          </p>
                        )}
                      </article>
                    </div>
                  ) : (
                    <div className="empty">
                      <h3>
                        {detail.run.status === "queued"
                          ? "Waiting for your worker"
                          : "No pages saved yet"}
                      </h3>
                      <p>
                        Keep the worker running on your computer. Results appear
                        here as each page is collected.
                      </p>
                    </div>
                  )}
                  {detail.pages.length > 0 && (
                    <button
                      className="secondary"
                      onClick={async () => {
                        try {
                          const response = await fetch(
                            `/api/runs/${selected}/export`,
                          );
                          if (!response.ok) throw Error();
                          await navigator.clipboard.writeText(
                            await response.text(),
                          );
                          setCopied(true);
                        } catch {
                          setError(
                            "Could not copy the run. Use Download instead.",
                          );
                        }
                      }}
                    >
                      {copied ? "Copied" : "Copy full run"}
                    </button>
                  )}
                </section>
              ) : (
                <>
                  {folder && (
                    <p className="folder-crumb">
                      Showing{" "}
                      <strong>
                        {folder === "root"
                          ? "Unfiled"
                          : folderPath(folders, folder) || "folder"}
                      </strong>
                      <button
                        className="text-button"
                        onClick={() => navigate({ folder: "", page: "" })}
                      >
                        Show all runs
                      </button>
                    </p>
                  )}
                  {picked.size > 0 && (
                    <div
                      className="bulk-bar"
                      role="region"
                      aria-label="Selected runs"
                    >
                      <span>{picked.size} selected</span>
                      <label className="inline-select">
                        <span>Move to</span>
                        <select
                          defaultValue="-"
                          key={picked.size}
                          onChange={(e) => {
                            if (e.target.value !== "-")
                              void moveRuns([...picked], e.target.value);
                          }}
                        >
                          <option value="-" disabled>
                            Choose folder
                          </option>
                          <FolderOptions folders={folders} />
                        </select>
                      </label>
                      <button
                        className="secondary danger-text"
                        disabled={pickedRunning}
                        title={
                          pickedRunning
                            ? "A selected run is still collecting."
                            : undefined
                        }
                        onClick={() => askDeleteRuns([...picked], "")}
                      >
                        Delete selected
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setPicked(new Set())}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                  <RunTable
                    runs={runs}
                    loading={loading}
                    picked={picked}
                    onPick={setPicked}
                  />
                  <div className="pagination">
                    <button
                      className="secondary"
                      disabled={Number(params.get("page") || 1) <= 1}
                      onClick={() =>
                        navigate({
                          page: String(Number(params.get("page") || 1) - 1),
                        })
                      }
                    >
                      Previous
                    </button>
                    <span>Page {params.get("page") || 1}</span>
                    <button
                      className="secondary"
                      disabled={!hasMore}
                      onClick={() =>
                        navigate({
                          page: String(Number(params.get("page") || 1) + 1),
                        })
                      }
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <footer className="workspace-footer">
          <span>Source first. Interpretation is yours.</span>
          <span>
            {system
              ? `${size(system.storage_bytes)} database on this computer`
              : "Local collection history"}
            <span className="footer-zone">Times shown in IST</span>
          </span>
        </footer>
      </main>
    </>
  );
}
function RunTable({
  runs,
  loading,
  picked,
  onPick,
}: {
  runs: Run[];
  loading: boolean;
  picked?: Set<string>;
  onPick?: (next: Set<string>) => void;
}) {
  const toggle = (id: string) => {
    if (!picked || !onPick) return;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onPick(next);
  };
  const all =
    !!picked && runs.length > 0 && runs.every((r) => picked.has(r.id));
  if (loading)
    return (
      <div className="loading" role="status">
        <p>Loading saved collections…</p>
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  if (!runs.length)
    return (
      <div className="empty">
        <span aria-hidden="true" className="empty-mark">
          ⌑
        </span>
        <h3>Your first source starts here</h3>
        <p>Add a link to build your collection history.</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {picked && onPick && (
              <th className="pick">
                <input
                  type="checkbox"
                  aria-label="Select all runs on this page"
                  checked={all}
                  onChange={() =>
                    onPick(all ? new Set() : new Set(runs.map((r) => r.id)))
                  }
                />
              </th>
            )}
            <th>Collection</th>
            <th>Collected</th>
            <th>Status</th>
            <th>Pages</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className={picked?.has(run.id) ? "picked" : undefined}
              draggable={!!onPick}
              onDragStart={(e) => {
                // Dragging a ticked row carries every ticked run with it.
                const ids =
                  picked?.has(run.id) && picked.size > 1
                    ? [...picked]
                    : [run.id];
                e.dataTransfer.setData(RUN_DRAG, JSON.stringify(ids));
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              {picked && onPick && (
                <td className="pick">
                  <input
                    type="checkbox"
                    aria-label={`Select ${run.title}`}
                    checked={picked.has(run.id)}
                    onChange={() => toggle(run.id)}
                  />
                </td>
              )}
              <td>
                <Link
                  className="run-title"
                  href={`/?view=history&run=${run.id}`}
                >
                  {run.title}
                </Link>
                <small>{run.urls[0]}</small>
              </td>
              <td>
                <time dateTime={run.created_at}>{when(run.created_at)}</time>
              </td>
              <td>
                <span className={"status " + run.status}>{run.status}</span>
              </td>
              <td className="num">
                {run.success_count || 0} / {run.page_count || 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
