// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The root layout normally supplies the session provider.
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ status: "loading" }) }));

describe("landing page server module", () => {
  it("imports and renders without browser globals", { timeout: 60_000 }, async () => {
    expect(typeof window).toBe("undefined");
    const { default: LandingPage } = await import("./page");
    const html = renderToStaticMarkup(LandingPage());
    expect(html).toContain("Know if your week fits");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="This week: 18 hours of coursework, 14 hours available, 4 hours short. Start the essay on Tuesday to catch up."');
    const preview = html.match(/<div[^>]*role="img"[^>]*>/)?.[0];
    expect(preview).toBeDefined();
    expect(preview).not.toContain(" inert");
    expect(html).toContain(`${preview}<div inert="">`);
    expect(html).toContain("4h short this week.");
    expect(html).toContain("Your real hours, not an ideal week.");
    expect(html).toContain("How StudyFlow works");
    expect(html).toContain("Simple pricing for students");
    expect(html).toContain("Know now, not in week nine.");
    expect(html).toContain('id="how-it-works"');
    expect(html).not.toMatch(/<a[^>]*>\s*<button/);
  });
});
