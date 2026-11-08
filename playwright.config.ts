import { defineConfig } from "@playwright/test";
// Browser tests get their own dev server on port 3100 with a separate
// database, so they never touch the owner's app on 3000 or its history.
// They need dev mode: the /dev/collector previews return 404 in production.
const PORT = 3100;
export default defineConfig({
  testDir: "./browser-tests",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    env: { LOCAL_DATABASE_DIR: ".runtime/test-db" },
  },
  reporter: "list",
});
