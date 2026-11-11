import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security/headers";

/**
 * The browser always talks to the Next.js origin at `/api/v1/*`, and Next
 * proxies those calls through to FastAPI. Keeping both on one origin means:
 *
 *   - no CORS configuration is needed on the backend for local development,
 *   - the `SameSite=Strict` session cookie is sent on every request,
 *   - the non-httpOnly CSRF cookie is readable by our own JavaScript.
 */
const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // Keep the development launcher clear of the sidebar account menu.
  devIndicators: { position: "bottom-right" },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendOrigin}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        // The nonce-based Content-Security-Policy is per request; see proxy.ts.
        headers: staticSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
