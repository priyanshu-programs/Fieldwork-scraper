import type { Run } from "@/lib/types";
export const states = [
  "offline",
  "idle",
  "preparing",
  "fetching",
  "cleaning",
  "saving",
  "pageComplete",
  "retrying",
  "partial",
  "failed",
  "runComplete",
] as const;
export type CollectorState = (typeof states)[number];
export const captions: Record<CollectorState, string> = {
  offline: "Local worker disconnected",
  idle: "Worker connected",
  preparing: "Preparing collection",
  fetching: "Collecting page",
  cleaning: "Cleaning page content",
  saving: "Saving source record",
  pageComplete: "Source record preserved",
  retrying: "Retrying failed page",
  partial: "Pages need attention",
  failed: "Collection needs attention",
  runComplete: "Collection preserved",
};
export function collectorState(
  online: boolean,
  run?: Run | null,
): CollectorState {
  if (!online) return "offline";
  if (!run) return "idle";
  if (run.status === "completed") return "runComplete";
  if (run.status === "partial") return "partial";
  if (run.status === "failed" || run.status === "interrupted") return "failed";
  if (run.status === "queued") return run.retry_of ? "retrying" : "preparing";
  return run.progress?.stage ?? "fetching";
}
export function pageCount(run: Run) {
  const done = Number(run.success_count || 0),
    processed = Number(run.page_count || 0);
  const total =
    run.mode === "pages"
      ? run.urls.length
      : ["completed", "partial", "failed", "interrupted"].includes(run.status)
        ? processed
        : null;
  return { done, processed, total, failed: processed - done };
}
// Poll responses may overlap. Terminal runs cannot regress; ordered stage snapshots cannot regress.
export function acceptSnapshot(previous: Run | null, next: Run): Run {
  if (!previous || previous.id !== next.id) return next;
  const terminal = (r: Run) => !["queued", "running"].includes(r.status);
  if (terminal(previous) && !terminal(next)) return previous;
  if ((next.page_count || 0) < (previous.page_count || 0)) return previous;
  if (
    !terminal(next) &&
    (next.progress_seq || 0) < (previous.progress_seq || 0)
  )
    return previous;
  return next;
}
