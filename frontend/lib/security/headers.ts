/**
 * Browser security headers for the Next.js app (#63).
 *
 * These headers are set for every response in `next.config.ts`.
 * The nonce-based Content-Security-Policy is a later change.
 */

/**
 * Deliberately short while the policy beds in. Read docs/security-headers.md
 * before raising it. There is no `preload`, so it can be walked back within an
 * hour.
 */
export const HSTS_MAX_AGE_SECONDS = 3600;

export interface HeaderEntry {
  key: string;
  value: string;
}

export function staticSecurityHeaders(): HeaderEntry[] {
  return [
    // WebMCP: tools may only be registered by this origin.
    { key: "Permissions-Policy", value: "tools=(self)" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Legacy companion to `frame-ancestors 'none'` for browsers without CSP2.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Strict-Transport-Security", value: `max-age=${HSTS_MAX_AGE_SECONDS}` },
  ];
}
