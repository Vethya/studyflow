#!/usr/bin/env node

import os from "node:os";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";

const DEFAULT_EMAIL = "nfr02_benchmark@studyflow.local";
const DEFAULT_PASSWORD = "BenchmarkPassword123!";
const DEFAULT_RUNS = 20;
const DEFAULT_THRESHOLD_SECONDS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const BROWSER_CHANNEL = "chrome";

const PAGES = [
  {
    name: "Dashboard",
    path: "/dashboard",
    expectedResponses: [
      { label: "50 tasks", path: "/api/v1/tasks", validate: arrayWithAtLeast(50) },
      { label: "5 availability windows", path: "/api/v1/availability/windows", validate: arrayWithAtLeast(5) },
      { label: "50 unavailable periods", path: "/api/v1/availability/unavailable-periods", validate: arrayWithAtLeast(50) },
      { label: "250 study sessions", path: "/api/v1/study-sessions", validate: arrayWithAtLeast(250) },
    ],
  },
  {
    name: "Tasks",
    path: "/tasks",
    expectedResponses: [
      { label: "50 tasks", path: "/api/v1/tasks", validate: arrayWithAtLeast(50) },
    ],
  },
  {
    name: "Availability",
    path: "/availability",
    expectedResponses: [
      { label: "5 availability windows", path: "/api/v1/availability/windows", validate: arrayWithAtLeast(5) },
      { label: "50 unavailable periods", path: "/api/v1/availability/unavailable-periods", validate: arrayWithAtLeast(50) },
    ],
  },
  {
    name: "Schedule",
    path: "/calendar",
    expectedResponses: [
      { label: "50 tasks", path: "/api/v1/tasks", validate: arrayWithAtLeast(50) },
      { label: "5 availability windows", path: "/api/v1/availability/windows", validate: arrayWithAtLeast(5) },
      { label: "50 unavailable periods", path: "/api/v1/availability/unavailable-periods", validate: arrayWithAtLeast(50) },
      { label: "250 study sessions", path: "/api/v1/study-sessions", validate: arrayWithAtLeast(250) },
    ],
  },
  {
    name: "Progress",
    path: "/progress",
    expectedResponses: [
      { label: "50 tasks", path: "/api/v1/tasks", validate: arrayWithAtLeast(50) },
      { label: "250 study sessions", path: "/api/v1/study-sessions", validate: arrayWithAtLeast(250) },
    ],
  },
];

function arrayWithAtLeast(minimum) {
  return (body) => Array.isArray(body) && body.length >= minimum;
}

function parseArgs(argv) {
  const args = {
    baseUrl: "http://127.0.0.1:3000",
    email: process.env.NFR02_BENCHMARK_EMAIL ?? DEFAULT_EMAIL,
    password: process.env.NFR02_BENCHMARK_PASSWORD ?? DEFAULT_PASSWORD,
    runs: DEFAULT_RUNS,
    threshold: DEFAULT_THRESHOLD_SECONDS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    viewportWidth: 1440,
    viewportHeight: 900,
    jsonOutput: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    index += 1;

    const numberKeys = new Set([
      "runs",
      "threshold",
      "timeout_ms",
      "viewport_width",
      "viewport_height",
    ]);
    if (numberKeys.has(key)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${token}`);
      args[camelCase(key)] = parsed;
    } else if (key === "base_url") {
      args.baseUrl = value.replace(/\/$/, "");
    } else if (key === "email") {
      args.email = value;
    } else if (key === "password") {
      args.password = value;
    } else if (key === "json_output") {
      args.jsonOutput = value;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function camelCase(value) {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function printUsage() {
  console.log(`Usage: node benchmarks/page_performance.mjs [options]

Options:
  --base-url URL             Dev frontend URL
  --runs N                   Measured runs per page (default: 20)
  --threshold N              Page p95 limit in seconds (default: 3)
  --timeout-ms N             Per-navigation timeout (default: 30000)
  --viewport-width N         Browser viewport width (default: 1440)
  --viewport-height N        Browser viewport height (default: 900)
  --json-output PATH         Write raw samples and summary to JSON
  --email EMAIL              Seeded benchmark account email
  --password PASSWORD        Seeded benchmark account password`);
}

function percentile95(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function writeJsonReport(path, report) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function makeReport(args) {
  return {
    benchmark: "nfr02-browser-pages",
    started_at: new Date().toISOString(),
    base_url: args.baseUrl,
    runs: args.runs,
    warmup_runs_per_page: 1,
    threshold_seconds: args.threshold,
    viewport: {
      width: args.viewportWidth,
      height: args.viewportHeight,
    },
    browser: null,
    pages: [],
    status: "failed",
  };
}

function targetUrl(baseUrl, path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function waitUntilPageIsUsable(page, timeoutMs) {
  await page.getByRole("heading", { level: 1 }).waitFor({
    state: "visible",
    timeout: timeoutMs,
  });
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main");
      return (
        main !== null &&
        main.querySelector("h1") !== null &&
        main.querySelectorAll('[data-slot="skeleton"]').length === 0
      );
    },
    undefined,
    { timeout: timeoutMs },
  );
}

async function measureNavigation(page, url, timeoutMs, expectedResponses) {
  const apiErrors = [];
  const requestErrors = [];
  const onResponse = (response) => {
    if (response.url().includes("/api/") && response.status() >= 500) {
      apiErrors.push(`${response.status()} ${response.url()}`);
    }
  };
  const onRequestFailed = (request) => {
    if (request.url().includes("/api/")) {
      requestErrors.push(`${request.failure()?.errorText ?? "request failed"} ${request.url()}`);
    }
  };

  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  const started = performance.now();
  let error = null;

  try {
    const expectedResponsePromises = expectedResponses.map((expectation) =>
      page
        .waitForResponse(
          async (response) => {
            if (!response.url().includes(expectation.path) || response.status() !== 200) {
              return false;
            }
            try {
              return expectation.validate(await response.json());
            } catch {
              return false;
            }
          },
          { timeout: timeoutMs },
        )
        .then(() => null)
        .catch((cause) => `${expectation.label}: ${cause instanceof Error ? cause.message : cause}`),
    );
    const [response, expectedResponseErrors] = await Promise.all([
      page.goto(url, {
        timeout: timeoutMs,
        waitUntil: "domcontentloaded",
      }),
      Promise.all(expectedResponsePromises),
    ]);
    if (response && response.status() >= 400) {
      throw new Error(`Page navigation returned HTTP ${response.status()}`);
    }
    const missingResponses = expectedResponseErrors.filter((value) => value !== null);
    if (missingResponses.length > 0) {
      throw new Error(missingResponses.join("; "));
    }
    await waitUntilPageIsUsable(page, timeoutMs);
    if (apiErrors.length || requestErrors.length) {
      throw new Error([...apiErrors, ...requestErrors].join("; "));
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }

  return {
    seconds: (performance.now() - started) / 1000,
    error,
  };
}

async function login(page, args) {
  await page.goto(targetUrl(args.baseUrl, "/login"), {
    timeout: args.timeoutMs,
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Email").fill(args.email);
  await page.getByLabel("Password").fill(args.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), {
    timeout: args.timeoutMs,
  });
  await waitUntilPageIsUsable(page, args.timeoutMs);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const report = makeReport(args);
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: true });
  report.browser = {
    engine: "Google Chrome",
    channel: BROWSER_CHANNEL,
    version: browser.version(),
    user_agent: null,
    node: process.version,
    operating_system: `${process.platform} ${os.release()} (${os.arch()})`,
    cpu_count: os.cpus().length,
    memory_bytes: os.totalmem(),
  };

  try {
    const context = await browser.newContext({
      viewport: { width: args.viewportWidth, height: args.viewportHeight },
    });
    const page = await context.newPage();
    report.browser.user_agent = await page.evaluate(() => navigator.userAgent);
    await login(page, args);

    for (const target of PAGES) {
      const url = targetUrl(args.baseUrl, target.path);
      const warmup = await measureNavigation(
        page,
        url,
        args.timeoutMs,
        target.expectedResponses,
      );
      const samples = [];
      const errors = [];

      if (warmup.error) errors.push({ run: "warmup", error: warmup.error });

      for (let runNumber = 1; runNumber <= args.runs; runNumber += 1) {
        const result = await measureNavigation(
          page,
          url,
          args.timeoutMs,
          target.expectedResponses,
        );
        samples.push(result.seconds);
        if (result.error) errors.push({ run: runNumber, error: result.error });
      }

      const sorted = [...samples].sort((left, right) => left - right);
      const p95 = percentile95(samples);
      const result = {
        name: target.name,
        path: target.path,
        warmup_seconds: warmup.seconds,
        warmup_error: warmup.error,
        sample_seconds: samples,
        minimum_seconds: sorted[0],
        median_seconds: sorted[Math.floor(sorted.length / 2)],
        maximum_seconds: sorted[sorted.length - 1],
        p95_seconds: p95,
        errors,
        status: errors.length === 0 && p95 < args.threshold ? "passed" : "failed",
      };
      report.pages.push(result);

      console.log(
        `| ${target.name} | ${result.minimum_seconds.toFixed(4)}s | ` +
          `${result.median_seconds.toFixed(4)}s | ${result.maximum_seconds.toFixed(4)}s | ` +
          `**${result.p95_seconds.toFixed(4)}s** | ${args.threshold.toFixed(1)}s | ` +
          `${result.status === "passed" ? "PASS" : "FAIL"} |`,
      );
    }

    report.status = report.pages.every((pageResult) => pageResult.status === "passed")
      ? "passed"
      : "failed";
    report.finished_at = new Date().toISOString();
  } finally {
    await browser.close();
    await writeJsonReport(args.jsonOutput, report);
  }

  return report.status === "passed" ? 0 : 1;
}

run()
  .then((exitCode) => process.exit(exitCode))
  .catch(async (cause) => {
    console.error(`Browser benchmark failed: ${cause instanceof Error ? cause.message : cause}`);
    process.exit(1);
  });
