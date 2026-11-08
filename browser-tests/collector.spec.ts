import { test, expect } from "@playwright/test";
test("Collector states, unique IDs, reduced frames, clock lifecycle and narrow layout", async ({
  page,
}) => {
  await page.goto("/dev/collector");
  const art = page.locator("svg").first();
  for (const state of [
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
  ]) {
    await page.getByLabel("State", { exact: true }).selectOption(state);
    await expect(art).toHaveAttribute("data-state", state);
  }
  const ids = await page
    .locator("svg [id]")
    .evaluateAll((nodes) => nodes.map((n) => n.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.getByLabel("Reduced motion").check();
  await page.waitForTimeout(150);
  const frame = await art.getAttribute("data-time");
  await page.waitForTimeout(200);
  expect(await art.getAttribute("data-time")).toBe(frame);
  await page.getByLabel("Reduced motion").uncheck();
  await page.getByLabel("State", { exact: true }).selectOption("fetching");
  await page.waitForTimeout(150);
  const moving = await art.getAttribute("data-time");
  await page.waitForTimeout(150);
  expect(await art.getAttribute("data-time")).not.toBe(moving);
  await page.getByLabel("Pause", { exact: true }).check();
  const frozen = await art.getAttribute("data-time");
  await page.waitForTimeout(150);
  expect(await art.getAttribute("data-time")).toBe(frozen);
  await page.getByLabel("Pause", { exact: true }).uncheck();
  await art.evaluate((e) => {
    (e as SVGElement).style.display = "none";
  });
  await page.waitForTimeout(100);
  const hidden = await art.getAttribute("data-time");
  await page.waitForTimeout(180);
  expect(await art.getAttribute("data-time")).toBe(hidden);
  await art.evaluate((e) => {
    (e as SVGElement).style.display = "";
  });
  await page.getByRole("button", { name: "Rapid events" }).click();
  await page.waitForTimeout(1300);
  await expect(art).toHaveAttribute("data-state", "runComplete");
  await page.getByLabel("Disconnect", { exact: true }).check();
  await expect(page.getByRole("status")).toHaveText(
    "Local worker disconnected",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".runtime/screenshots/collector-phone.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Disconnect", { exact: true }).uncheck();
  await page.getByLabel("State", { exact: true }).selectOption("cleaning");
  await page.waitForTimeout(700);
  await page.screenshot({
    path: ".runtime/screenshots/collector-desktop.png",
    fullPage: true,
  });
  await page.goto("/login");
});

test("collection submission keeps panel dimensions and updates real snapshot labels", async ({
  page,
}) => {
  let submitted = false,
    stage = "fetching",
    done = 0;
  const run = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Browser fixture",
    description: "",
    urls: ["https://example.com/a"],
    mode: "pages",
    fetch_mode: "http",
    status: "running",
    created_at: "2026-11-07T00:00:00Z",
    started_at: null,
    finished_at: null,
    retry_of: null,
    byte_count: 0,
    error: null,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/system")
      return route.fulfill({
        json: {
          online: true,
          last_seen: new Date().toISOString(),
          storage_bytes: 0,
          allowance_bytes: 1000000000,
        },
      });
    if (route.request().method() === "POST") {
      submitted = true;
      return route.fulfill({ json: { ...run, status: "queued" } });
    }
    if (url.pathname === `/api/runs/${run.id}`)
      return route.fulfill({
        json: {
          run: {
            ...run,
            status: done ? "completed" : "running",
            progress: { stage, url: run.urls[0] },
            progress_seq: done ? 2 : 1,
          },
          pages: done
            ? [{ id: "page", url: run.urls[0], status: "success" }]
            : [],
        },
      });
    return route.fulfill({
      json: {
        runs: submitted
          ? [{ ...run, page_count: done, success_count: done }]
          : [],
        has_more: false,
      },
    });
  });
  await page.goto("/dev/collector/workspace");
  const panel = page.locator(".collector-panel-frame");
  const before = await panel.boundingBox();
  await page.getByLabel("Source links").fill(run.urls[0]);
  await page.getByRole("button", { name: "Start collection" }).click();
  await expect(
    page.getByRole("heading", { name: "Collecting page", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".collector-source")).toHaveText("example.com");
  expect((await panel.boundingBox())?.height).toBe(before?.height);
  done = 1;
  stage = "pageComplete";
  await expect(
    page.getByRole("heading", { name: "Collection preserved" }),
  ).toBeVisible({ timeout: 7000 });
  await expect(panel).toContainText("1 of 1 pages collected");
  await expect(
    page.getByRole("link", { name: "Browser fixture" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".runtime/screenshots/collector-integrated.png",
    fullPage: true,
  });
});
