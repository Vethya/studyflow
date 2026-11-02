/**
 * UI-only development: runs the in-memory mock API in this process and
 * starts Next.js against it. No Docker, backend or database needed.
 *
 *   npm run dev:ui                  # dev server on http://localhost:3000
 *   npm run dev:ui -- --port 3100   # extra arguments go to Next.js
 *   npm run preview:ui              # production build: the real speed
 *
 * `next dev` compiles each page the first time it is opened, which is what
 * makes a first click feel slow. The dev server is warmed by requesting every
 * page once in the background; the preview mode builds once and serves the
 * optimised bundle with link prefetching, as students will get it.
 *
 * Env: MOCK_API_PORT (default 8010), MOCK_API_LATENCY_MS (default 120), PORT.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startMockApi } from "./mock-api/server.mjs";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const rawArgs = process.argv.slice(2);
const production = rawArgs.includes("--prod");
const args = rawArgs.filter((arg) => arg !== "--prod");
const portFlag = args.findIndex((arg) => arg === "--port" || arg === "-p");
const inlinePort = args.find((arg) => arg.startsWith("--port="));
const appPort =
  (portFlag >= 0 ? args[portFlag + 1] : undefined) ??
  inlinePort?.slice("--port=".length) ??
  process.env.PORT ??
  "3000";

const WARM_ROUTES = ["/login", "/dashboard", "/tasks", "/calendar", "/availability", "/progress", "/settings"];

const api = await startMockApi({ port: Number(process.env.MOCK_API_PORT ?? 8010) });
const env = { ...process.env, BACKEND_ORIGIN: api.url };

console.log(
  `\n  StudyFlow UI ${production ? "preview (production build)" : "mode"}: http://localhost:${appPort}  (API mocked in memory at ${api.url}; data resets on restart)` +
    `\n  Demo student:  demo.student@example.com / demo-password-123` +
    `\n  New student:   new.student@example.com / new-student-123  (empty account, first visit)\n`,
);

function run(command) {
  return spawn(process.execPath, [nextBin, ...command], { stdio: "inherit", env });
}

async function warmUp() {
  const base = `http://localhost:${appPort}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(`${base}/login`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const started = Date.now();
  for (const route of WARM_ROUTES) {
    try {
      await fetch(`${base}${route}`);
    } catch {
      // The server is going away; nothing to warm.
      return;
    }
  }
  console.log(`  Pages compiled and ready (${((Date.now() - started) / 1000).toFixed(1)}s).\n`);
}

let next;
if (production) {
  const build = run(["build"]);
  const code = await new Promise((resolve) => build.on("exit", (exitCode) => resolve(exitCode ?? 1)));
  if (code !== 0) {
    await api.close();
    process.exit(code);
  }
  next = run(["start", ...args]);
} else {
  next = run(["dev", ...args]);
  void warmUp();
}

const forward = (signal) => {
  if (next.exitCode === null) next.kill(signal);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

next.on("exit", (code, signal) => {
  void api.close().finally(() => process.exit(code ?? (signal ? 1 : 0)));
});
