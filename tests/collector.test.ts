import { describe, it, expect } from "vitest";
import {
  collectorState,
  pageCount,
  acceptSnapshot,
  states,
} from "../src/components/collector/model";
import type { Run } from "../src/lib/types";
const run = {
  id: "a",
  status: "running",
  mode: "crawl",
  urls: ["https://example.com"],
  page_count: 5,
  success_count: 3,
  progress_seq: 4,
} as Run;
describe("Collector snapshots", () => {
  it("connection overrides all states", () => {
    for (const stage of states)
      expect(
        collectorState(false, {
          ...run,
          progress: { stage: stage as never, url: run.urls[0] },
        }),
      ).toBe("offline");
  });
  it("maps reported phases and final outcomes", () => {
    for (const stage of [
      "fetching",
      "cleaning",
      "saving",
      "retrying",
      "pageComplete",
      "failed",
    ] as const)
      expect(
        collectorState(true, { ...run, progress: { stage, url: run.urls[0] } }),
      ).toBe(stage);
    expect(collectorState(true, { ...run, status: "partial" })).toBe("partial");
    expect(collectorState(true, { ...run, status: "completed" })).toBe(
      "runComplete",
    );
    expect(collectorState(true, { ...run, status: "interrupted" })).toBe(
      "failed",
    );
  });
  it("preserves counts and truthfully unknown crawl total", () => {
    expect(pageCount(run)).toEqual({
      done: 3,
      processed: 5,
      total: null,
      failed: 2,
    });
    expect(pageCount({ ...run, status: "partial" }).total).toBe(5);
  });
  it("rejects out-of-order stages and terminal regression", () => {
    expect(acceptSnapshot(run, { ...run, progress_seq: 3 })).toBe(run);
    const end = { ...run, status: "completed" as const };
    expect(acceptSnapshot(end, run)).toBe(end);
  });
  it("linked retry gets its own state without modifying original records", () => {
    expect(
      collectorState(true, {
        ...run,
        id: "b",
        retry_of: "a",
        status: "queued",
      }),
    ).toBe("retrying");
    expect(pageCount(run).done).toBe(3);
  });
});
