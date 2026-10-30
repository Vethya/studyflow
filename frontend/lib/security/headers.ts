/**
 * Browser security headers for the Next.js app (#63).
 *
 * The static headers are set for every response in `next.config.ts`. The
 * Content-Security-Policy needs a fresh nonce per request, so `proxy.ts` sets
 * it. Next.js reads the nonce back out of the request's CSP header and attaches
 * it to its own scripts. The root layout passes it to next-themes for the inline
 * theme script.
 */

/** Request header that carries the per-request nonce to Server Components. */
export const NONCE_HEADER = "x-nonce";
export const CSP_HEADER = "Content-Security-Policy";

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

/** 128 random bits, base64-encoded; works in the Node and Edge runtimes. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export interface PolicyOptions {
  /** `next dev`: React needs eval to rebuild server error stacks. */
  development?: boolean;
  /**
   * Whether the page was served over HTTPS. Only then are subresources
   * upgraded, so local `next start` on http://localhost (CI smoke test) keeps
   * working.
   */
  https?: boolean;
}

export function contentSecurityPolicy(
  nonce: string,
  { development = false, https = true }: PolicyOptions = {},
): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets nonced Next.js scripts load their own chunks, and
    // makes browsers ignore host allowlists and 'self' for scripts.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Style attributes (layout positions, charts) and runtime-injected <style>
    // tags cannot carry a nonce, and a nonce in this directive would disable
    // 'unsafe-inline'. Script execution is what the policy protects.
    "style-src 'self' 'unsafe-inline'",
    // Google account avatars are the only remote images.
    "img-src 'self' blob: data: https://*.googleusercontent.com",
    // next/font self-hosts the Google fonts at build time.
    "font-src 'self'",
    // All API traffic goes through the same-origin /api/v1 rewrite.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https && !development ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}
