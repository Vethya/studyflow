import { NextResponse, type NextRequest } from "next/server";

/**
 * Same-origin API proxy.
 *
 * The browser calls `/api/v1/*` on the frontend origin and this proxy forwards the call to
 * FastAPI. Because the API then sees the frontend's egress address instead of the browser's,
 * the proxy also forwards the end-user address so per-IP rate limits apply per user rather
 * than per egress address. The backend accepts that address only together with the shared
 * secret in `STUDYFLOW_FRONTEND_PROXY_SECRET`, compared in constant time.
 */
export const CLIENT_IP_HEADER = "x-studyflow-client-ip";
export const PROXY_SECRET_HEADER = "x-studyflow-proxy-secret";

export interface ApiProxyEnvironment {
  /** FastAPI origin, for example `https://studyflow-api.onrender.com`. */
  BACKEND_ORIGIN?: string;
  /** Shared with the API. Unset locally, which disables client IP forwarding. */
  STUDYFLOW_FRONTEND_PROXY_SECRET?: string;
  /** Set to `"1"` by Vercel at runtime. */
  VERCEL?: string;
}

export const DEFAULT_BACKEND_ORIGIN = "http://localhost:8000";

/**
 * The end-user address as verified by Vercel's edge.
 *
 * Vercel overwrites `x-real-ip` and `x-vercel-forwarded-for` with the connecting client's
 * address, so a browser cannot choose them. Outside Vercel the same headers would be client
 * controlled, so no address is reported there.
 */
export function verifiedClientIp(headers: Headers, env: ApiProxyEnvironment): string | null {
  if (env.VERCEL !== "1") return null;
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const vercelForwardedFor = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  return vercelForwardedFor || null;
}

/** Request headers for the upstream API call. Client-supplied copies of our headers are dropped. */
export function upstreamRequestHeaders(incoming: Headers, env: ApiProxyEnvironment): Headers {
  const headers = new Headers(incoming);
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SECRET_HEADER);
  const secret = env.STUDYFLOW_FRONTEND_PROXY_SECRET;
  const clientIp = verifiedClientIp(incoming, env);
  if (secret && clientIp) {
    headers.set(CLIENT_IP_HEADER, clientIp);
    headers.set(PROXY_SECRET_HEADER, secret);
  }
  return headers;
}

export function upstreamUrl(request: NextRequest, env: ApiProxyEnvironment): URL {
  const origin = env.BACKEND_ORIGIN ?? DEFAULT_BACKEND_ORIGIN;
  return new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, origin);
}

/** Rewrite `/api/v1/*` to the API, with the request headers the API needs. */
export function proxyApiRequest(
  request: NextRequest,
  env: ApiProxyEnvironment = {
    BACKEND_ORIGIN: process.env.BACKEND_ORIGIN,
    STUDYFLOW_FRONTEND_PROXY_SECRET: process.env.STUDYFLOW_FRONTEND_PROXY_SECRET,
    VERCEL: process.env.VERCEL,
  },
): NextResponse {
  return NextResponse.rewrite(upstreamUrl(request, env), {
    request: { headers: upstreamRequestHeaders(request.headers, env) },
  });
}
