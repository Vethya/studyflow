import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

// Visual and navigation smoke checks with isolated API fixtures; no account writes.
const origin = process.env.DASHBOARD_PREVIEW_ORIGIN ?? "http://localhost:3100";
const output = process.env.DASHBOARD_PREVIEW_OUTPUT ?? "test-results/dashboard-redesign";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.DASHBOARD_BROWSER_CHANNEL ?? "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let populated = false;
  let planned = false;
  await page.addInitScript(() => localStorage.setItem("studyflow:welcome-seen", "1"));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    let status = 200;
    if (path.endsWith("/auth/session")) body = { account: { id: "visual-student", name: "Alex Student", email: "alex@example.com" } };
    else if (path.endsWith("/account/preferences")) body = { timezone: "Asia/Bangkok", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: false };
    else if (path.endsWith("/schedule-proposals/current")) { body = { detail: "No pending proposal" }; status = 404; }
    else if (planned && path.endsWith("/study-sessions")) body = [
      { id: "completed-session", task_id: "biology", starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() - 86400000 + 3600000).toISOString(), planned_duration_minutes: 60, outcome: { session_id: "completed-session", kind: "completed", actual_minutes: 45, remaining_minutes: 75, recorded_at: new Date().toISOString(), rescheduled_at: null } },
      { id: "next-session", task_id: "biology", starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 86400000 + 3600000).toISOString(), planned_duration_minutes: 60, outcome: null },
    ];
    else if (populated && path.endsWith("/availability/windows")) body = Array.from({ length: 7 }, (_, weekday) => ({ id: `window-${weekday}`, weekday, start_time: "16:00:00", end_time: "19:00:00", crosses_midnight: false }));
    else if (populated && path.endsWith("/tasks")) body = [
      { id: "biology", title: "Review biology chapter 4", category: "reading", priority: "medium", course: "Biology", notes: null, deadline_at: new Date(Date.now() + 3 * 86400000).toISOString(), original_estimate_minutes: 120, adaptive_estimate_minutes: null, planned_source: "original", planned_duration_minutes: 120, status: "not_started", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ];
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${origin}/dashboard`);
  await page.getByRole("heading", { name: "Start with your study hours" }).waitFor();
  await page.screenshot({ path: `${output}/desktop-new-student.png`, fullPage: true });
  const sidebar = page.locator('[data-slot="sidebar"]').first();
  assert.equal(await sidebar.getAttribute("data-state"), "expanded");
  const activeLink = page.getByRole("navigation", { name: "Study navigation" }).getByRole("link", { name: "Dashboard" });
  assert.equal(await activeLink.evaluate(el => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-blue-500)";
    el.append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(el).backgroundColor === expected;
  }), true, "The source block uses a solid-blue active item");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My profile" }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: "My profile" }).getAttribute("href"), "/settings");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle Sidebar" }).last().click();
  await page.waitForTimeout(300);
  assert.equal(await sidebar.getAttribute("data-state"), "collapsed");
  assert.equal(await page.getByRole("navigation", { name: "Study navigation" }).getByRole("link", { name: "Dashboard" }).getAttribute("aria-label"), "Dashboard");
  await page.screenshot({ path: `${output}/desktop-collapsed.png`, fullPage: true });
  populated = true;
  await page.reload();
  await page.getByRole("heading", { name: "Turn your tasks into a study plan" }).waitFor();
  await page.screenshot({ path: `${output}/desktop-with-tasks.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem("studyflow-theme", "dark"));
  await page.reload();
  await page.getByRole("heading", { name: "Turn your tasks into a study plan" }).waitFor();
  await page.screenshot({ path: `${output}/desktop-dark.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem("studyflow-theme", "light"));
  await page.reload();
  await page.getByRole("heading", { name: "Turn your tasks into a study plan" }).waitFor();
  planned = true;
  await page.reload();
  await page.getByText("Study overview", { exact: true }).waitFor();
  await page.locator('main').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.screenshot({ path: `${output}/desktop-study-charts.png`, fullPage: true });
  planned = false;
  await page.reload();
  await page.getByRole("heading", { name: "Turn your tasks into a study plan" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "Mobile layout should not overflow horizontally");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("navigation", { name: "Study navigation" }).getByRole("link", { name: "Tasks", exact: true }).click();
  await page.waitForURL("**/tasks");
  await page.locator('[data-mobile="true"]').waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-mobile="true"]').count(), 0, "Selecting a route should close mobile navigation");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(`Dashboard desktop, collapsed sidebar, new-user flow, mobile overflow and navigation checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
