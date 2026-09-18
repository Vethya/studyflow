import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const useLocalServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/nfr05/results.json" }],
    ["./e2e/nfr05-reporter.ts", { outputFile: "test-results/nfr05/evidence.md" }],
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    // Scan finished pages rather than fade-ins caught mid-animation.
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], browserName: "chromium", channel: "chrome" },
    },
    {
      name: "edge",
      use: { ...devices["Desktop Chrome"], browserName: "chromium", channel: "msedge" },
    },
    {
      name: "safari-webkit",
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], browserName: "chromium", channel: "chrome" },
    },
    {
      name: "mobile-safari-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
  ...(useLocalServer
    ? {
        webServer: {
          command: "pnpm dev",
          cwd: process.cwd(),
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            NEXT_TELEMETRY_DISABLED: "1",
          },
        },
      }
    : {}),
});
