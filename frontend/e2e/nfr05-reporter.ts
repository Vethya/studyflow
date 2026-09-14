import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

interface ReporterOptions {
  outputFile?: string;
}

interface TestSummary {
  title: string;
  project: string;
  status: string;
  duration: number;
  browser: string;
  browserVersion: string;
  os: string;
  axeAnnotations: string[];
}

interface RuntimeEnvironment {
  browser: string;
  version: string;
  os: string;
}

function readRuntimeEnvironment(
  annotations: Array<{ type: string; description?: string }>,
): RuntimeEnvironment {
  const annotation = annotations.find((candidate) => candidate.type === "environment");
  if (!annotation?.description) {
    return { browser: "unknown", version: "unknown", os: "unknown" };
  }

  try {
    const environment = JSON.parse(annotation.description) as Partial<RuntimeEnvironment>;
    if (
      typeof environment.browser === "string" &&
      typeof environment.version === "string" &&
      typeof environment.os === "string"
    ) {
      return environment as RuntimeEnvironment;
    }
  } catch {
    // Keep report generation resilient if a test emits malformed metadata.
  }

  return { browser: "unknown", version: "unknown", os: "unknown" };
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export default class Nfr05Reporter implements Reporter {
  private readonly outputFile: string;
  private readonly tests: TestSummary[] = [];
  private config: FullConfig | undefined;

  constructor(options: ReporterOptions = {}) {
    this.outputFile = options.outputFile ?? "test-results/nfr05/evidence.md";
  }

  onBegin(config: FullConfig, suite: Suite): void {
    void suite;
    this.config = config;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const environment = readRuntimeEnvironment(result.annotations);
    this.tests.push({
      title: test.titlePath().slice(2).join(" › "),
      project: test.parent.project()?.name ?? "unknown",
      status: result.status,
      duration: result.duration,
      browser: environment.browser,
      browserVersion: environment.version,
      os: environment.os,
      axeAnnotations: result.annotations
        .filter((annotation) => annotation.type === "axe")
        .map((annotation) => annotation.description ?? "axe scan"),
    });
  }

  onEnd(result: FullResult): void {
    const outputPath = resolve(process.cwd(), this.outputFile);
    mkdirSync(dirname(outputPath), { recursive: true });

    const passed = this.tests.filter((test) => test.status === "passed").length;
    const failed = this.tests.filter((test) => test.status === "failed").length;
    const skipped = this.tests.filter((test) => test.status === "skipped").length;
    const projects = this.config?.projects ?? [];

    const lines = [
      "# NFR-05 compatibility and accessibility evidence",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Overall result: **${result.status}**` ,
      `Tests: ${passed} passed, ${failed} failed, ${skipped} skipped`,
      "",
      "## Automated matrix",
      "",
      "| Project | Configured coverage | Actual browser | Host operating system | Viewport source | Mobile context |",
      "| --- | --- | --- | --- | --- | --- |",
      ...projects.map((project) => {
        const use = project.use;
        const browser = use.channel ?? use.browserName ?? "default";
        const runtimes = [
          ...new Set(
            this.tests
              .filter((test) => test.project === project.name)
              .map((test) => `${test.browser} ${test.browserVersion}`),
          ),
        ];
        const operatingSystems = [
          ...new Set(
            this.tests
              .filter((test) => test.project === project.name)
              .map((test) => test.os),
          ),
        ];
        const viewport = project.name.startsWith("mobile-")
          ? "test-defined: 360×800"
          : "test-defined: 360×800, 768×1024, 1440×1000";
        const mobile = use.isMobile ? "yes" : "no";
        return `| ${markdownCell(project.name)} | ${markdownCell(String(browser))} | ${markdownCell(runtimes.join("; ") || "not recorded")} | ${markdownCell(operatingSystems.join("; ") || "not recorded")} | ${viewport} | ${mobile} |`;
      }),
      "",
      "The tests define the required 360, 768, and 1440 CSS-pixel viewports. Mobile projects use device emulation. The actual browser version and host operating system are captured at runtime. The `safari-webkit` projects are automated WebKit coverage, not Apple Safari; actual mobile Safari must be recorded with the companion iPhone checklist.",
      "Axe findings are recorded as soft assertions so all routes are scanned in one run; a failed test identifies accessibility findings that need review.",
      "",
      "## Test results",
      "",
      "| Project | Test | Status | Duration | Runtime | Accessibility annotations |",
      "| --- | --- | --- | ---: | --- | --- |",
      ...this.tests.map((test) => {
        const axe = test.axeAnnotations.length > 0 ? test.axeAnnotations.join("; ") : "—";
        const runtime = `${test.browser} ${test.browserVersion} on ${test.os}`;
        return `| ${markdownCell(test.project)} | ${markdownCell(test.title)} | ${test.status} | ${test.duration} ms | ${markdownCell(runtime)} | ${markdownCell(axe)} |`;
      }),
      "",
      "## Generated artifacts",
      "",
      "- `test-results/nfr05/results.json` — machine-readable Playwright results.",
      "- `playwright-report/index.html` — interactive report with failure traces and screenshots.",
      "- Accessibility scans are attached to the corresponding Playwright test results as JSON.",
      "",
      "## Manual companion",
      "",
      "Run the same core workflows on a current iPhone in Safari and complete [`docs/nfr05-mobile-safari-checklist.md`](../../../docs/nfr05-mobile-safari-checklist.md).",
      "",
    ];

    writeFileSync(outputPath, lines.join("\n"), "utf8");
  }
}
