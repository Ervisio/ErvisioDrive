import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ui",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3111",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/ui-server.mjs",
    url: "http://127.0.0.1:3111/login",
    timeout: 60000,
    reuseExistingServer: false,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "phone-360",
      use: {
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "phone-390",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet-768",
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 900 } } },
  ],
});
