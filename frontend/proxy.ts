import { NextResponse, type NextRequest } from "next/server";
import { proxyApiRequest } from "./lib/api-proxy";
import {
  CSP_HEADER,
  NONCE_HEADER,
  contentSecurityPolicy,
  createNonce,
} from "./lib/security/headers";

/**
 * Next.js 16 `proxy` (formerly `middleware`). It handles two kinds of request:
 *
 * - `/api/v1/*` is rewritten to the API with the authenticated end-user address; see
 *   `lib/api-proxy.ts`. The `next.config.ts` rewrite stays as a fallback with the same target.
 * - Pages get a per-request nonce-based Content-Security-Policy. The CSP must also be on the
 *   request so that Next.js can find the nonce while rendering and attach it to its scripts.
 */
export function proxy(request: NextRequest) {
  // The page matcher excludes `api/`, so only the API matcher sends requests here.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return proxyApiRequest(request);
  }

  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(CSP_HEADER, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER, policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: the API rewrite, build assets and public files do not render HTML.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|webmanifest)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    { source: "/api/v1/:path*" },
  ],
};
