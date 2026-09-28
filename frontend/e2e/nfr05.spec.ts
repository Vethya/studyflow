import AxeBuilder from "@axe-core/playwright";
import { arch, platform, release } from "node:os";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  FLOW_PROPOSAL_ID,
  FLOW_TASK_ID,
  FLOW_TASK_TITLE,
  installNfr05ApiMocks,
  MOCK_ACCOUNT,
} from "./nfr05-mocks";

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
] as const;

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/privacy",
  "/terms",
] as const;

const AUTHENTICATED_ROUTES = [
  {
    path: "/dashboard",
    heading: /Hello, Alex|Dashboard/,
    readyRequests: [
      "/api/v1/auth/session",
      "/api/v1/tasks",
      "/api/v1/availability/windows",
      "/api/v1/availability/unavailable-periods",
      "/api/v1/account/preferences",
      "/api/v1/study-sessions",
    ],
  },
  {
    path: "/tasks",
    heading: /^Tasks$/,
    readyRequests: ["/api/v1/auth/session", "/api/v1/tasks"],
  },
  {
    path: "/tasks/task-reading",
    heading: /Read cognitive science paper/,
    readyRequests: [
      "/api/v1/auth/session",
      "/api/v1/tasks/task-reading",
      "/api/v1/tasks",
      "/api/v1/study-sessions",
    ],
  },
  {
    path: "/calendar",
    heading: /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), | – /,
    readyRequests: [
      "/api/v1/auth/session",
      "/api/v1/tasks",
      "/api/v1/availability/windows",
      "/api/v1/availability/unavailable-periods",
      "/api/v1/study-sessions",
    ],
  },
  {
    path: "/availability",
    heading: /^Availability$/,
    readyRequests: [
      "/api/v1/auth/session",
      "/api/v1/availability/windows",
      "/api/v1/availability/unavailable-periods",
    ],
  },
  {
    path: "/progress",
    heading: /^Progress$/,
    readyRequests: ["/api/v1/auth/session", "/api/v1/tasks", "/api/v1/study-sessions"],
  },
  {
    path: "/import/google/import-calendar",
    heading: /^Review your Google Calendar events$/,
    readyRequests: [
      "/api/v1/auth/session",
      "/api/v1/integrations/google/imports/import-calendar",
    ],
  },
  {
    path: "/import/google/import-classroom",
    heading: /^Review your Google Classroom coursework$/,
    readyRequests: [
      "/api/v1/auth/session",
      "/api/v1/integrations/google/imports/import-classroom",
    ],
  },
  {
    path: "/import/google?error=permission",
    heading: /^Google import$/,
    readyRequests: ["/api/v1/auth/session"],
  },
  {
    path: "/settings",
    heading: /^Settings$/,
    readyRequests: [
      "/api/v1/auth/session",
      "/api/v1/account/profile",
      "/api/v1/account/preferences",
      "/api/v1/account/identities",
    ],
  },
] as const;

type RuntimeIssue = {
  kind: "console" | "pageerror" | "requestfailed";
  message: string;
};

function safeName(value: string): string {
  const cleaned = value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return cleaned || "home";
}

function installRuntimeMonitoring(page: Page): RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];

  page.on("console", (message) => {
    // The dashboard and calendar intentionally treat a missing pending
    // proposal as an ordinary 404, which Chromium reports as a console error.
    // WebKit can also report a lost Next.js dev-server HMR socket while the
    // page is running. That is test-server noise, not an application error.
    const locationUrl = message.location().url;
    const isExpectedHmrDisconnect =
      message.text().includes("WebSocket connection") &&
      message.text().includes("/_next/webpack-hmr");
    const isExpectedSignedOutSession =
      message.text().includes("401 (Unauthorized)") &&
      locationUrl.includes("/api/v1/auth/session");
    const isExpectedPendingProposal =
      message.text().includes("status of 404 (Not Found)") &&
      locationUrl.includes("/api/v1/schedule-proposals/current");
    if (
      message.type() === "error" &&
      !isExpectedPendingProposal &&
      !isExpectedHmrDisconnect &&
      !isExpectedSignedOutSession
    ) {
      issues.push({ kind: "console", message: `${message.text()} @ ${locationUrl}` });
    }
  });

  page.on("pageerror", (error) => {
    issues.push({ kind: "pageerror", message: error.message });
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure();
    // Navigating between routes cancels in-flight fetches during component
    // cleanup. Those cancellations are expected and are not runtime errors.
    if (
      failure &&
      !["net::ERR_ABORTED", "cancelled", "NS_BINDING_ABORTED"].includes(failure.errorText)
    ) {
      issues.push({
        kind: "requestfailed",
        message: `${request.method()} ${request.url()} — ${failure.errorText}`,
      });
    }
  });

  return issues;
}

async function waitForPageReady(page: Page, heading?: RegExp): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("body")).toBeVisible();
  if (heading) {
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  }
}

async function gotoAndWaitForPageReady(
  page: Page,
  path: string,
  heading: RegExp | undefined,
  readyRequests: readonly string[],
): Promise<void> {
  const responseWaits = readyRequests.map((expectedPath) =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === expectedPath &&
        response.request().method() === "GET" &&
        response.ok(),
    ),
  );

  await page.goto(path);
  await waitForPageReady(page, heading);
  await Promise.all(responseWaits);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    appMain: (() => {
      const main = document.querySelector("main");
      return main
        ? { scrollWidth: main.scrollWidth, clientWidth: main.clientWidth }
        : null;
    })(),
  }));

  expect(metrics.documentWidth, `document overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  expect(metrics.bodyWidth, `body overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  if (metrics.appMain) {
    expect(
      metrics.appMain.scrollWidth,
      `application scroll-container overflow: ${JSON.stringify(metrics)}`,
    ).toBeLessThanOrEqual(metrics.appMain.clientWidth + 1);
  }
}

async function assertControlNames(page: Page): Promise<void> {
  const unnamedControls = await page.locator("input:visible, textarea:visible, select:visible, button:visible, a[href]:visible").evaluateAll((elements) => {
    const issues: string[] = [];

    for (const element of elements) {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      if (
        node.id.startsWith("base-ui-") ||
        node.id.endsWith("-hidden-input") ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        continue;
      }
      const ariaLabel = node.getAttribute("aria-label")?.trim();
      const labelledBy = node.getAttribute("aria-labelledby")?.trim();
      const visibleText = node.textContent?.trim();
      const id = node.getAttribute("id");
      const associatedLabel = id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
        : node.closest("label");

      if (ariaLabel || labelledBy || visibleText || associatedLabel) continue;
      issues.push(`${node.tagName.toLowerCase()}${id ? `#${id}` : ""}`);
    }

    return issues;
  });

  expect(unnamedControls).toEqual([]);
}

async function assertKeyboardFocus(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  const focusStates: Array<{
    control: string;
    visible: boolean;
    isControl: boolean;
    focusVisible: boolean;
    indicator: boolean;
  }> = [];

  for (let index = 0; index < 16; index += 1) {
    const state = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;

      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;

      return {
        control: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
        visible: rect.width > 0 && rect.height > 0,
        isControl: element.matches(
          "a[href], button, input, textarea, select, [tabindex]:not([tabindex='-1'])",
        ),
        focusVisible: element.matches(":focus-visible"),
        indicator: outlineWidth > 0 && style.outlineStyle !== "none",
      };
    });

    if (state) focusStates.push(state);
    await page.keyboard.press("Tab");
  }

  const visibleControls = focusStates.filter((state) => state.visible && state.isControl);
  expect(visibleControls.length).toBeGreaterThan(0);
  expect(
    visibleControls.filter((state) => !state.focusVisible || !state.indicator),
    "Every visible keyboard-traversed control must expose its own focus indicator",
  ).toEqual([]);
}

async function scanAccessibility(page: Page, testInfo: TestInfo, route: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  testInfo.annotations.push({
    type: "axe",
    description: `${route}: ${results.violations.length} violation(s)`,
  });

  await testInfo.attach(`axe-${safeName(route)}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  // Keep scanning the remaining routes so the evidence report is complete.
  // The soft assertion still makes the test fail and preserves the violation
  // details, while WCAG 2.2 AA remains a non-blocking specification goal.
  expect.soft(results.violations, `${route} accessibility violations`).toEqual([]);
}

async function captureEvidence(page: Page, testInfo: TestInfo, route: string): Promise<void> {
  await testInfo.attach(`screenshot-${safeName(route)}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px viewport`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ browser }, testInfo) => {
      testInfo.annotations.push({
        type: "environment",
        description: JSON.stringify({
          browser: testInfo.project.use.channel ?? browser.browserType().name(),
          version: browser.version(),
          os: `${platform()} ${release()} (${arch()})`,
        }),
      });
    });

    test("public routes render without responsive or accessible regressions", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith("mobile-") && viewport.width !== 360, "Mobile projects run at 360px only.");

      const issues = installRuntimeMonitoring(page);
      const mockState = await installNfr05ApiMocks(page, { authenticated: false });

      for (const route of PUBLIC_ROUTES) {
        await test.step(route, async () => {
          await page.goto(route);
          await waitForPageReady(page);
          await assertNoHorizontalOverflow(page);
          await assertControlNames(page);
          await scanAccessibility(page, testInfo, route);
          await captureEvidence(page, testInfo, route);
        });
      }

      await testInfo.attach("runtime-issues.json", {
        body: JSON.stringify(issues, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("unhandled-api-requests.json", {
        body: JSON.stringify(mockState.unhandledRequests, null, 2),
        contentType: "application/json",
      });
      expect(issues).toEqual([]);
      expect(mockState.unhandledRequests).toEqual([]);
    });

    test("authenticated core routes render without responsive or accessible regressions", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith("mobile-") && viewport.width !== 360, "Mobile projects run at 360px only.");

      const issues = installRuntimeMonitoring(page);
      const mockState = await installNfr05ApiMocks(page, { authenticated: true });

      for (const route of AUTHENTICATED_ROUTES) {
        await test.step(route.path, async () => {
          await gotoAndWaitForPageReady(page, route.path, route.heading, route.readyRequests);
          await assertNoHorizontalOverflow(page);
          await assertControlNames(page);
          await scanAccessibility(page, testInfo, route.path);
          await captureEvidence(page, testInfo, route.path);
        });
      }

      await testInfo.attach("runtime-issues.json", {
        body: JSON.stringify(issues, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("unhandled-api-requests.json", {
        body: JSON.stringify(mockState.unhandledRequests, null, 2),
        contentType: "application/json",
      });
      expect(issues).toEqual([]);
      expect(mockState.unhandledRequests).toEqual([]);
    });

    test("login controls support keyboard operation and visible focus", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith("mobile-") && viewport.width !== 360, "Mobile projects run at 360px only.");

      const issues = installRuntimeMonitoring(page);
      const mockState = await installNfr05ApiMocks(page, { authenticated: false });

      await page.goto("/login");
      await waitForPageReady(page, /Welcome back/);
      await assertControlNames(page);
      await assertKeyboardFocus(page);

      await page.getByLabel("Email").focus();
      await page.keyboard.type(MOCK_ACCOUNT.email);
      await page.keyboard.press("Tab");
      const passwordInput = page.getByLabel("Password", { exact: true });
      await passwordInput.type("nfr05-password");
      await expect(passwordInput).toBeFocused();
      const loginResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/auth/login") &&
          response.request().method() === "POST",
      );
      await passwordInput.press("Enter");
      await expect((await loginResponse).status()).toBe(200);
      await expect.poll(() => mockState.authenticated).toBeTruthy();

      await testInfo.attach("runtime-issues.json", {
        body: JSON.stringify(issues, null, 2),
        contentType: "application/json",
      });
      expect(issues).toEqual([]);
    });

    test("task-to-schedule workflow completes", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith("mobile-") && viewport.width !== 360, "Mobile projects run at 360px only.");

      const issues = installRuntimeMonitoring(page);
      const mockState = await installNfr05ApiMocks(page, { authenticated: true });

      await gotoAndWaitForPageReady(
        page,
        "/calendar",
        /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), | – /,
        [
          "/api/v1/auth/session",
          "/api/v1/tasks",
          "/api/v1/availability/windows",
          "/api/v1/availability/unavailable-periods",
          "/api/v1/study-sessions",
        ],
      );

      await page.getByRole("button", { name: "Add task", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Title").fill(FLOW_TASK_TITLE);
      await dialog.getByLabel("Deadline").fill(
        new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString().slice(0, 16),
      );
      await dialog.getByLabel("Estimate (minutes)").fill("60");
      await dialog.getByRole("button", { name: "Add task", exact: true }).click();

      await expect(dialog).toBeHidden();
      await expect.poll(() => mockState.createdTaskIds).toContain(FLOW_TASK_ID);

      const proposalResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/schedule-proposals") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Plan my time", exact: true }).click();
      await expect((await proposalResponse).status()).toBe(201);
      await expect(page.getByRole("heading", { name: "Your proposed plan" })).toBeVisible();

      const acceptResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/schedule-proposals/${FLOW_PROPOSAL_ID}/accept`) &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Use this plan", exact: true }).click();
      await expect((await acceptResponse).status()).toBe(204);
      await expect.poll(() => mockState.acceptedProposalIds).toContain(FLOW_PROPOSAL_ID);
      await expect(page.getByRole("heading", { name: "Your proposed plan" })).toBeHidden();

      await testInfo.attach("runtime-issues.json", {
        body: JSON.stringify(issues, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("unhandled-api-requests.json", {
        body: JSON.stringify(mockState.unhandledRequests, null, 2),
        contentType: "application/json",
      });
      expect(issues).toEqual([]);
      expect(mockState.unhandledRequests).toEqual([]);
    });

    test("task statuses expose text cues in addition to color", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith("mobile-") && viewport.width !== 360, "Mobile projects run at 360px only.");

      const issues = installRuntimeMonitoring(page);
      await installNfr05ApiMocks(page, { authenticated: true });

      await gotoAndWaitForPageReady(
        page,
        "/tasks",
        /^Tasks$/,
        ["/api/v1/auth/session", "/api/v1/tasks"],
      );
      await expect(page.getByText("Not started", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("In progress", { exact: true }).first()).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await scanAccessibility(page, testInfo, "/tasks-status-cues");

      await testInfo.attach("runtime-issues.json", {
        body: JSON.stringify(issues, null, 2),
        contentType: "application/json",
      });
      expect(issues).toEqual([]);
    });
  });
}
