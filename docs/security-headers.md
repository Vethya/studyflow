# Browser security headers

The Next.js frontend sends these headers. The backend API is reached through the
same-origin `/api/v1` rewrite, so these headers are what protect the pages.

| Header | Value | Set in |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=3600` (no `includeSubDomains`, no `preload`) | `frontend/next.config.ts` |
| `X-Content-Type-Options` | `nosniff` | `frontend/next.config.ts` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `frontend/next.config.ts` |
| `X-Frame-Options` | `DENY` (legacy twin of `frame-ancestors 'none'`) | `frontend/next.config.ts` |
| `Permissions-Policy` | `tools=(self)` (WebMCP; unchanged) | `frontend/next.config.ts` |

All values come from `frontend/lib/security/headers.ts`.

## Raising HSTS later

HSTS starts at one hour, so a certificate or domain problem can be backed out quickly. Vercel
already sends its own long HSTS header on `*.vercel.app`, and that domain is preloaded. This
header matters for a custom domain.

1. After a week without HTTPS problems on the production domain, raise
   `HSTS_MAX_AGE_SECONDS` in `frontend/lib/security/headers.ts` to `86400` (one day).
2. After another stable period, raise it to `604800` (one week), then to `31536000` (one year).
3. Add `includeSubDomains` only when every subdomain of the custom domain serves HTTPS.
4. Add `preload` and submit to hstspreload.org only as a deliberate, near-permanent decision.
   Removal from browser preload lists takes months.

Update the test in `frontend/lib/security/headers.test.ts` when the value changes. It caps the
starting value at one day.
