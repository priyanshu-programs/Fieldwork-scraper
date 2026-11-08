import { test, expect, type Page } from "@playwright/test";

// In-memory stand-in for the private API so the History tree can be driven on
// the development-only harness. Server rules are covered in tests/.
const run = (
  id: string,
  title: string,
  folder_id: string | null,
  status = "completed",
) => ({
  id,
  title,
  description: "",
  urls: ["https://example.com/" + id],
  mode: "pages",
  fetch_mode: "http",
  status,
  retry_of: null,
  folder_id,
  created_at: "2026-11-07T10:00:00Z",
  started_at: null,
  finished_at: null,
  byte_count: 0,
  error: null,
  page_count: 1,
  success_count: 1,
});
async function mockApi(page: Page) {
  const state = {
    folders: [
      { id: "f-research", name: "Research", parent_id: null, created_at: "" },
      {
        id: "f-pricing",
        name: "Pricing",
        parent_id: "f-research",
        created_at: "",
      },
    ] as {
      id: string;
      name: string;
      parent_id: string | null;
      created_at: string;
    }[],
    runs: [
      run("r1", "Competitor pricing pages", "f-pricing"),
      run("r2", "Docs crawl", "f-research"),
      run("r3", "Loose notes", null),
      run("r4", "Still collecting", null, "running"),
    ],
    deleted: [] as string[],
  };
  let next = 0;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/", "");
    const body = req.postData() ? JSON.parse(req.postData()!) : {};
    if (path === "system")
      return route.fulfill({
        json: {
          online: true,
          last_seen: null,
          storage_bytes: 0,
          allowance_bytes: 1e9,
        },
      });
    if (path === "folders" && req.method() === "GET")
      return route.fulfill({
        json: {
          folders: state.folders.map((f) => ({
            ...f,
            run_count: state.runs.filter((r) => r.folder_id === f.id).length,
          })),
          runs: state.runs,
        },
      });
    if (path === "folders" && req.method() === "POST") {
      const f = {
        id: "f-new-" + next++,
        name: body.name,
        parent_id: body.parent_id,
        created_at: "",
      };
      state.folders.push(f);
      return route.fulfill({ status: 201, json: f });
    }
    if (path.startsWith("folders/") && path.endsWith("/move")) {
      // Same rule as the service: place among siblings before/after an anchor.
      const id = path.split("/")[1];
      const moving = state.folders.find((x) => x.id === id)!;
      state.folders = state.folders.filter((x) => x.id !== id);
      moving.parent_id = body.parent_id;
      const anchor = body.before_id ?? body.after_id;
      let at = anchor ? state.folders.findIndex((x) => x.id === anchor) : -1;
      if (at < 0) at = state.folders.length;
      else if (body.after_id) at += 1;
      state.folders.splice(at, 0, moving);
      return route.fulfill({ json: moving });
    }
    if (path.startsWith("folders/")) {
      const id = path.slice(8);
      const f = state.folders.find((x) => x.id === id)!;
      if (req.method() === "PATCH") Object.assign(f, body);
      if (req.method() === "DELETE") {
        for (const r of state.runs)
          if (r.folder_id === id) r.folder_id = f.parent_id;
        for (const c of state.folders)
          if (c.parent_id === id) c.parent_id = f.parent_id;
        state.folders = state.folders.filter((x) => x.id !== id);
      }
      return route.fulfill({ json: f });
    }
    if (path === "runs/delete") {
      state.deleted.push(...body.ids);
      state.runs = state.runs.filter((r) => !body.ids.includes(r.id));
      return route.fulfill({ json: { deleted: body.ids.length } });
    }
    if (path === "runs/move") {
      for (const r of state.runs)
        if (body.ids.includes(r.id)) r.folder_id = body.folder_id;
      return route.fulfill({ json: { moved: body.ids.length } });
    }
    if (path === "runs") {
      const folder = url.searchParams.get("folder") || "";
      const runs = state.runs.filter((r) =>
        !folder
          ? true
          : folder === "root"
            ? r.folder_id === null
            : r.folder_id === folder,
      );
      return route.fulfill({ json: { runs, has_more: false, page: 1 } });
    }
    const one = state.runs.find((r) => "runs/" + r.id === path);
    if (one) return route.fulfill({ json: { run: one, pages: [] } });
    return route.fulfill({ status: 404, json: { error: "Not found" } });
  });
  return state;
}

test("folder tree files, renames, deletes folders and deletes runs with confirmation", async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto("/dev/collector/workspace?view=history");
  const tree = page.getByRole("tree", { name: "Folders and runs" });
  await expect(tree.getByRole("treeitem", { name: "Research" })).toBeVisible();

  // Keyboard: open Research, move into Pricing, open it and select its run.
  await tree.getByRole("treeitem", { name: "All runs" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(tree.getByRole("treeitem", { name: "Research" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    tree.getByRole("treeitem", { name: "Research" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tree.getByRole("treeitem", { name: "Pricing" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/folder=f-pricing/);
  await expect(page.locator(".folder-crumb")).toContainText(
    "Research / Pricing",
  );
  await expect(page.locator("tbody tr")).toHaveCount(1);

  // Create a top-level folder inline.
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Archive");
  await page.keyboard.press("Enter");
  await expect(tree.getByRole("treeitem", { name: "Archive" })).toBeVisible();

  // Rename with F2.
  await tree.getByRole("treeitem", { name: "Archive" }).focus();
  await page.keyboard.press("F2");
  await page.getByLabel("Folder name").fill("Old work");
  await page.keyboard.press("Enter");
  await expect(tree.getByRole("treeitem", { name: "Old work" })).toBeVisible();

  // Deleting a folder keeps its runs: Pricing's run moves up into Research.
  await tree.getByRole("treeitem", { name: "Pricing" }).focus();
  await page.keyboard.press("Delete");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("move to “Research”");
  await dialog.getByRole("button", { name: "Delete folder" }).click();
  await expect(dialog).toBeHidden();
  expect(state.runs.find((r) => r.id === "r1")?.folder_id).toBe("f-research");

  // Bulk delete from the table through the in-page confirmation.
  await page.goto("/dev/collector/workspace?view=history");
  await page.getByLabel("Select Loose notes").check();
  await page.getByLabel("Select Docs crawl").check();
  await expect(page.locator(".bulk-bar")).toContainText("2 selected");
  await page.getByRole("button", { name: "Delete selected" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete 2 runs?");
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(state.deleted).toEqual([]);
  await page.getByRole("button", { name: "Delete selected" }).click();
  await page.getByRole("button", { name: "Delete 2 runs" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  expect(state.deleted.sort()).toEqual(["r2", "r3"]);

  // A running run cannot be deleted.
  await page.getByLabel("Select Still collecting").check();
  await expect(
    page.getByRole("button", { name: "Delete selected" }),
  ).toBeDisabled();

  await page.screenshot({
    path: ".runtime/screenshots/folders-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dev/collector/workspace?view=history&folder=f-research");
  await expect(tree.getByRole("treeitem", { name: "Research" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: ".runtime/screenshots/folders-phone.png",
    fullPage: true,
  });
});

test("collect form files a new run into the chosen folder", async ({
  page,
}) => {
  await mockApi(page);
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posted = JSON.parse(route.request().postData()!);
    return route.fulfill({
      status: 201,
      json: run("r9", "New", "f-pricing", "queued"),
    });
  });
  await page.goto("/dev/collector/workspace");
  await page.getByLabel("Source links").fill("https://example.com/new");
  await page.getByLabel("Folder").selectOption({ label: "   Pricing" });
  await page.getByRole("button", { name: "Start collection" }).click();
  await expect.poll(() => posted?.folder_id).toBe("f-pricing");
});

test("adds a subfolder and files runs by dragging them onto folders", async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto("/dev/collector/workspace?view=history");
  const tree = page.getByRole("tree", { name: "Folders and runs" });

  // New subfolder from the hover button on Research.
  await tree
    .getByRole("treeitem", { name: "Research" })
    .locator(".bm-row")
    .first()
    .hover();
  await page.getByRole("button", { name: "New subfolder" }).first().click();
  await page.getByLabel("Folder name").fill("Interviews");
  await page.keyboard.press("Enter");
  const made = state.folders.find((f) => f.name === "Interviews");
  expect(made?.parent_id).toBe("f-research");
  await expect(
    tree.getByRole("treeitem", { name: "Interviews" }),
  ).toBeVisible();

  // Drag a table row onto the new folder.
  await page
    .locator("tbody tr", { hasText: "Loose notes" })
    .dragTo(
      tree
        .getByRole("treeitem", { name: "Interviews" })
        .locator(".bm-row")
        .first(),
    );
  await expect
    .poll(() => state.runs.find((r) => r.id === "r3")?.folder_id)
    .toBe(made!.id);

  // Drag a run inside the tree back to Unfiled.
  await tree
    .getByRole("treeitem", { name: "Docs crawl" })
    .locator(".bm-row")
    .first()
    .dragTo(
      tree
        .getByRole("treeitem", { name: "Unfiled" })
        .locator(".bm-row")
        .first(),
    );
  await expect
    .poll(() => state.runs.find((r) => r.id === "r2")?.folder_id)
    .toBeNull();
});

test("reorders folders by dragging between them and nests them by dropping inside", async ({
  page,
}) => {
  const state = await mockApi(page);
  state.folders.push({
    id: "f-zeta",
    name: "Zeta",
    parent_id: null,
    created_at: "",
  });
  const top = () =>
    state.folders.filter((f) => f.parent_id === null).map((f) => f.name);
  await page.goto("/dev/collector/workspace?view=history");
  const tree = page.getByRole("tree", { name: "Folders and runs" });
  const row = (name: string) =>
    tree.getByRole("treeitem", { name }).locator(".bm-row").first();
  await expect(row("Zeta")).toBeVisible();
  expect(top()).toEqual(["Research", "Zeta"]);

  // Drop on the top edge of Research: Zeta moves above it.
  await row("Zeta").dragTo(row("Research"), {
    targetPosition: { x: 60, y: 3 },
  });
  await expect.poll(top).toEqual(["Zeta", "Research"]);

  // Drop in the middle of Zeta: Research goes inside Zeta.
  await row("Research").dragTo(row("Zeta"), {
    targetPosition: { x: 60, y: 17 },
  });
  await expect
    .poll(() => state.folders.find((f) => f.id === "f-research")?.parent_id)
    .toBe("f-zeta");
  await expect.poll(top).toEqual(["Zeta"]);

  // A folder cannot be dropped inside its own subfolder. The drop opened Zeta
  // but leaves Research collapsed as it was, so open it to reach Pricing.
  await tree
    .getByRole("treeitem", { name: "Research" })
    .getByRole("button", { name: "Expand" })
    .first()
    .click();
  await expect(row("Pricing")).toBeVisible();
  await row("Zeta").dragTo(row("Pricing"), {
    targetPosition: { x: 60, y: 17 },
  });
  expect(state.folders.find((f) => f.id === "f-zeta")?.parent_id).toBeNull();

  // Keyboard: Alt+Down moves Research below its new sibling.
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Inbox");
  await page.keyboard.press("Enter");
  await expect(row("Inbox")).toBeVisible();
  await tree.getByRole("treeitem", { name: "Inbox" }).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(top).toEqual(["Inbox", "Zeta"]);
});
