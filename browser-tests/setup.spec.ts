import { test, expect } from "@playwright/test";
// Local-only app: no sign-in. Pages open directly on 127.0.0.1, and
// the private API answers this computer only (host rules are unit-tested).
test("opens without sign-in and moves between Collect and History", async ({
  page,
  request,
}) => {
  await page.goto("/");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(
    page.getByRole("heading", { name: "Keep what you find." }),
  ).toBeVisible();
  await expect(
    page.getByText("On this computer", { exact: true }),
  ).toBeVisible();
  expect((await request.get("/api/runs")).status()).toBe(200);
  expect((await request.get("/login")).status()).toBe(404);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Collection history" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tree", { name: "Folders and runs" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Collect", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New collection" }),
  ).toBeVisible();
});
test("refuses changes sent from another website", async ({ request }) => {
  const response = await request.post("/api/folders", {
    headers: { origin: "https://evil.example" },
    data: { name: "Should not exist" },
  });
  expect(response.status()).toBe(403);
});
test("phone layout fits and navigation is keyboard accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.screenshot({
    path: ".runtime/screenshots/collect-phone.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".runtime/screenshots/collect-desktop.png",
    fullPage: true,
  });
});
