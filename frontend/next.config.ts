import type { NextConfig } from "next";

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
        headers: [{ key: "Permissions-Policy", value: "tools=(self)" }],
      },
    ];
  },
};

export default nextConfig;
