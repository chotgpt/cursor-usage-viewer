import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.002,
      scale: "css",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    colorScheme: "dark",
    deviceScaleFactor: 1,
    locale: "zh-CN",
    reducedMotion: "reduce",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
