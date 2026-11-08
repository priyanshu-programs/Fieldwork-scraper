import type { Page, RunDetail } from "./types";
export function pageMarkdown(page: Page) {
  return `# ${page.title || page.url}\n\nSource: ${page.final_url || page.url}\nCollected: ${new Date(page.collected_at).toISOString()}\nStatus: ${page.status}\n${page.error ? `Error: ${page.error}\n` : ""}\n${page.markdown}\n`;
}
export function combinedMarkdown({ run, pages }: RunDetail) {
  return `# ${run.title}\n\nRequested: ${new Date(run.created_at).toISOString()}\nRequest: ${run.description || "No description"}\nMode: ${run.mode} / ${run.fetch_mode}\n\n${pages.map(pageMarkdown).join("\n---\n\n")}`;
}
export function backupJson(detail: RunDetail) {
  return JSON.stringify(
    {
      format: "research-crawler/v1",
      exported_at: new Date().toISOString(),
      ...detail,
    },
    null,
    2,
  );
}
