import { describe, expect, it } from "vitest";
import {
  HSTS_MAX_AGE_SECONDS,
  contentSecurityPolicy,
  createNonce,
  staticSecurityHeaders,
} from "./headers";

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

describe("security headers", () => {
  it("keeps WebMCP's Permissions-Policy and adds the static hardening headers", () => {
    const headers = Object.fromEntries(staticSecurityHeaders().map(({ key, value }) => [key, value]));
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

  it("creates unpredictable base64 nonces", () => {
    const nonces = new Set(Array.from({ length: 20 }, createNonce));
    expect(nonces.size).toBe(20);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });

  it("builds a strict production policy around the nonce", () => {
    const policy = directives(contentSecurityPolicy("abc"));
    expect(policy.get("script-src")).toBe("'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy.get("frame-ancestors")).toBe("'none'");
    expect(policy.get("object-src")).toBe("'none'");
    expect(policy.get("base-uri")).toBe("'self'");
    expect(policy.get("form-action")).toBe("'self'");
    expect(policy.get("connect-src")).toBe("'self'");
    expect(policy.has("upgrade-insecure-requests")).toBe(true);
    expect(policy.get("script-src")).not.toContain("unsafe-inline");
    expect(policy.get("script-src")).not.toContain("unsafe-eval");
  });

  it("allows eval only in development", () => {
    const policy = directives(contentSecurityPolicy("abc", { development: true }));
    expect(policy.get("script-src")).toBe("'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'");
    expect(policy.has("upgrade-insecure-requests")).toBe(false);
  });

  it("upgrades subresources only for pages served over HTTPS", () => {
    const policy = directives(contentSecurityPolicy("abc", { https: false }));
    expect(policy.has("upgrade-insecure-requests")).toBe(false);
    expect(policy.get("script-src")).toBe("'self' 'nonce-abc' 'strict-dynamic'");
  });
});
