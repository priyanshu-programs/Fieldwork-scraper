"use client";
import Link from "next/link";
import type { Run, SystemStatus } from "@/lib/types";
import Collector from "./collector";
import { collectorState, captions, pageCount } from "./model";
export default function CollectorPanel({
  run,
  system,
  submitting = false,
  preserved = 0,
}: {
  run: Run | null;
  system: SystemStatus | null;
  submitting?: boolean;
  preserved?: number;
}) {
  const state = collectorState(!!system?.online, run),
    counts = run ? pageCount(run) : null;
  const url = run?.progress?.url;
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {}
  return (
    <section className="collector-panel" aria-label="Local collection worker">
      <div className="collector-heading">
        <span className="small muted">LOCAL WORKER</span>
        <span className="small">
          {system?.online ? "Connected" : "Disconnected"}
        </span>
      </div>
      <Collector
        state={submitting && system?.online ? "preparing" : state}
        completed={(counts?.done || 0) + preserved}
        failed={counts?.failed}
        crawl={run?.mode === "crawl"}
      />
      <div aria-live="polite" aria-atomic="true">
        <h2>
          {submitting && system?.online
            ? "Preparing collection"
            : captions[state]}
        </h2>
        {host && (
          <p className="collector-source" title={url}>
            {host}
          </p>
        )}
        {counts && (
          <p>
            {counts.done}
            {counts.total !== null ? ` of ${counts.total}` : ""} pages collected
            {counts.failed > 0 ? ` · ${counts.failed} need attention` : ""}
          </p>
        )}
        {run?.mode === "crawl" && (
          <p className="small muted">
            Same host · 2 link levels · 25 pages maximum
            <br />
            Discovered total remains unknown until the run ends.
          </p>
        )}
        {run?.error && <p className="error">{run.error}</p>}
        {run?.status === "interrupted" && (
          <p>Worker lease expired. Saved records remain available.</p>
        )}
        {!url && run?.status === "running" && (
          <p className="small muted">
            Waiting for the worker’s next source update.
          </p>
        )}
      </div>
      {preserved > 0 && (
        <p className="small muted">
          {preserved} records remain preserved in the original run.
        </p>
      )}
      {run && (
        <Link href={`/?view=history&run=${run.id}`}>
          Inspect run
          {["partial", "failed", "interrupted"].includes(run.status)
            ? " and retry failures"
            : ""}
        </Link>
      )}
    </section>
  );
}
