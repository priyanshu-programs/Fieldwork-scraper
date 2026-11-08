export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "interrupted";
export type PageStatus =
  | "success"
  | "failed"
  | "blocked"
  | "unsupported"
  | "limit";
export interface Run {
  id: string;
  title: string;
  description: string;
  urls: string[];
  mode: "pages" | "crawl";
  fetch_mode: "http" | "browser";
  status: RunStatus;
  progress?: {
    stage:
      | "fetching"
      | "cleaning"
      | "saving"
      | "retrying"
      | "pageComplete"
      | "failed";
    url: string;
  };
  progress_seq?: number;
  retry_of: string | null;
  folder_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  byte_count: number;
  error: string | null;
  page_count?: number;
  success_count?: number;
}
export interface Page {
  id: string;
  run_id: string;
  url: string;
  final_url: string | null;
  parent_url: string | null;
  title: string;
  status: PageStatus;
  error: string | null;
  markdown: string;
  collected_at: string;
}
export interface RunDetail {
  run: Run;
  pages: Page[];
}
export interface SystemStatus {
  last_seen: string | null;
  online: boolean;
  storage_bytes: number;
}
export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  position?: number;
  created_at: string;
  run_count?: number;
}
