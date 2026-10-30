// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  proxyApiRequest,
  upstreamRequestHeaders,
  upstreamUrl,
  verifiedClientIp,
} from "./api-proxy";

const SECRET = "s".repeat(40);
const VERCEL_ENV = { VERCEL: "1", STUDYFLOW_FRONTEND_PROXY_SECRET: SECRET, BACKEND_ORIGIN: "https://api.example.com" };

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "https://studyflow.example.com"), { headers });
}

describe("verifiedClientIp", () => {
  it("prefers Vercel's x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": " 198.51.100.7 ", "x-vercel-forwarded-for": "203.0.113.1" });
    expect(verifiedClientIp(headers, { VERCEL: "1" })).toBe("198.51.100.7");
  });

  it("falls back to the first x-vercel-forwarded-for entry", () => {
    const headers = new Headers({ "x-vercel-forwarded-for": "198.51.100.8, 10.0.0.1" });
    expect(verifiedClientIp(headers, { VERCEL: "1" })).toBe("198.51.100.8");
  });

  it("reports nothing when Vercel supplied no address", () => {
    expect(verifiedClientIp(new Headers(), { VERCEL: "1" })).toBeNull();
    expect(verifiedClientIp(new Headers({ "x-real-ip": " ", "x-vercel-forwarded-for": " ," }), { VERCEL: "1" })).toBeNull();
  });

  it("never trusts these headers outside Vercel, where the client controls them", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7", "x-vercel-forwarded-for": "198.51.100.7" });
    expect(verifiedClientIp(headers, {})).toBeNull();
    expect(verifiedClientIp(headers, { VERCEL: "0" })).toBeNull();
  });
});

describe("upstreamRequestHeaders", () => {
  it("forwards the verified address with the shared secret on Vercel", () => {
    const headers = upstreamRequestHeaders(new Headers({ "x-real-ip": "198.51.100.7", cookie: "a=b" }), VERCEL_ENV);
    expect(headers.get(CLIENT_IP_HEADER)).toBe("198.51.100.7");
    expect(headers.get(PROXY_SECRET_HEADER)).toBe(SECRET);
    expect(headers.get("cookie")).toBe("a=b");
  });

  it("replaces client-supplied copies of the proxy headers", () => {
    const incoming = new Headers({ "x-real-ip": "198.51.100.7", [CLIENT_IP_HEADER]: "203.0.113.66", [PROXY_SECRET_HEADER]: "guess" });
    const headers = upstreamRequestHeaders(incoming, VERCEL_ENV);
    expect(headers.get(CLIENT_IP_HEADER)).toBe("198.51.100.7");
    expect(headers.get(PROXY_SECRET_HEADER)).toBe(SECRET);
  });

  it.each([
    ["the secret is unset", { VERCEL: "1" }],
    ["the secret is blank", { VERCEL: "1", STUDYFLOW_FRONTEND_PROXY_SECRET: "" }],
    ["it is not running on Vercel", { STUDYFLOW_FRONTEND_PROXY_SECRET: SECRET }],
  ])("strips the proxy headers and adds none when %s", (_label, env) => {
    const incoming = new Headers({ "x-real-ip": "198.51.100.7", [CLIENT_IP_HEADER]: "203.0.113.66", [PROXY_SECRET_HEADER]: "guess" });
    const headers = upstreamRequestHeaders(incoming, env);
    expect(headers.has(CLIENT_IP_HEADER)).toBe(false);
    expect(headers.has(PROXY_SECRET_HEADER)).toBe(false);
  });

  it("adds nothing when Vercel supplied no address", () => {
    const headers = upstreamRequestHeaders(new Headers(), VERCEL_ENV);
    expect(headers.has(CLIENT_IP_HEADER)).toBe(false);
    expect(headers.has(PROXY_SECRET_HEADER)).toBe(false);
  });
});

describe("upstreamUrl", () => {
  it("keeps the path and query on the configured backend origin", () => {
    expect(upstreamUrl(request("/api/v1/tasks?page=2&q=a%20b"), VERCEL_ENV).toString()).toBe(
      "https://api.example.com/api/v1/tasks?page=2&q=a%20b",
    );
  });

  it("defaults to the local API like next.config.ts", () => {
    expect(upstreamUrl(request("/api/v1/health"), {}).toString()).toBe("http://localhost:8000/api/v1/health");
  });
});

describe("proxyApiRequest", () => {
  it("rewrites to the API and overrides the upstream request headers", () => {
    const response = proxyApiRequest(request("/api/v1/auth/register", { "x-real-ip": "198.51.100.7", [CLIENT_IP_HEADER]: "203.0.113.66" }), VERCEL_ENV);
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://api.example.com/api/v1/auth/register");
    expect(response.headers.get("x-middleware-override-headers")?.split(",")).toEqual(
      expect.arrayContaining([CLIENT_IP_HEADER, PROXY_SECRET_HEADER, "x-real-ip"]),
    );
    expect(response.headers.get(`x-middleware-request-${CLIENT_IP_HEADER}`)).toBe("198.51.100.7");
    expect(response.headers.get(`x-middleware-request-${PROXY_SECRET_HEADER}`)).toBe(SECRET);
  });

  it("never exposes the secret as a response header to the browser", () => {
    const response = proxyApiRequest(request("/api/v1/health", { "x-real-ip": "198.51.100.7" }), VERCEL_ENV);
    expect(response.headers.has(PROXY_SECRET_HEADER)).toBe(false);
  });

  it("reads process.env by default", () => {
    const response = proxyApiRequest(request("/api/v1/health"));
    expect(response.headers.get("x-middleware-rewrite")).toMatch(/\/api\/v1\/health$/);
  });
});
