import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

function nonceIn(policy: string | null): string {
  const match = /'nonce-([^']+)'/.exec(policy ?? "");
  if (!match) throw new Error(`no nonce in ${policy}`);
  return match[1];
}

describe("CSP proxy", () => {
  it("sends a fresh nonce-based policy on the response and to the renderer", () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = proxy(new NextRequest("https://studyflow.example/dashboard"));
    const second = proxy(new NextRequest("https://studyflow.example/dashboard"));
    const policy = first.headers.get("Content-Security-Policy");

    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("unsafe-eval");
    expect(nonceIn(policy)).not.toBe(nonceIn(second.headers.get("Content-Security-Policy")));
    // NextResponse.next forwards overridden request headers to the renderer this way.
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonceIn(policy));
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
  });

  it("allows eval in development only", () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = proxy(new NextRequest("http://localhost:3000/"));
    expect(response.headers.get("Content-Security-Policy")).toContain("'unsafe-eval'");
  });

  it("does not upgrade subresources for a local production server on plain HTTP", () => {
    vi.stubEnv("NODE_ENV", "production");
    const policy = proxy(new NextRequest("http://127.0.0.1:3000/")).headers.get("Content-Security-Policy");
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("runs on pages but not on the API rewrite, build assets or prefetches", () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp(`^${matcher.source}$`);
    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/dashboard")).toBe(true);
    expect(pattern.test("/tasks/123")).toBe(true);
    expect(pattern.test("/api/v1/tasks")).toBe(false);
    expect(pattern.test("/_next/static/chunks/main.js")).toBe(false);
    expect(pattern.test("/favicon.ico")).toBe(false);
    expect(pattern.test("/hero.png")).toBe(false);
    expect(matcher.missing?.map((header) => header.key)).toEqual(["next-router-prefetch", "purpose"]);
  });

  it("also runs on API calls, without prefetch exclusions", () => {
    expect(config.matcher[1]).toEqual({ source: "/api/v1/:path*" });
  });
});

describe("API proxy", () => {
  it("rewrites API calls to the backend with the verified client address and no CSP", () => {
    vi.stubEnv("BACKEND_ORIGIN", "https://api.example");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("STUDYFLOW_FRONTEND_PROXY_SECRET", "s".repeat(40));
    const response = proxy(
      new NextRequest("https://studyflow.example/api/v1/tasks?page=2", {
        headers: { "x-real-ip": "198.51.100.7", "x-studyflow-client-ip": "203.0.113.9" },
      }),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe("https://api.example/api/v1/tasks?page=2");
    expect(response.headers.get("x-middleware-request-x-studyflow-client-ip")).toBe("198.51.100.7");
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });
});
