import { describe, expect, it } from "vitest";
import { HSTS_MAX_AGE_SECONDS, staticSecurityHeaders } from "./headers";

describe("security headers", () => {
  it("keeps WebMCP's Permissions-Policy and adds the static hardening headers", () => {
    const headers = Object.fromEntries(
      staticSecurityHeaders().map(({ key, value }) => [key, value]),
    );
    expect(headers).toEqual({
      "Permissions-Policy": "tools=(self)",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Strict-Transport-Security": `max-age=${HSTS_MAX_AGE_SECONDS}`,
    });
  });

  it("starts HSTS short and without preload", () => {
    expect(HSTS_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(300);
    expect(HSTS_MAX_AGE_SECONDS).toBeLessThanOrEqual(86_400);
    const hsts = staticSecurityHeaders().find(({ key }) => key === "Strict-Transport-Security");
    expect(hsts?.value).not.toContain("preload");
  });
});
