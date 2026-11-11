# Browser security headers

The Next.js frontend sends these headers. The backend API is reached through the
same-origin `/api/v1` rewrite, so these headers are what protect the pages.

| Header | Value | Set in |
| --- | --- | --- |
| `Content-Security-Policy` | Per-request nonce policy (below) | `frontend/proxy.ts` |
| `Strict-Transport-Security` | `max-age=3600` (no `includeSubDomains`, no `preload`) | `frontend/next.config.ts` |
| `X-Content-Type-Options` | `nosniff` | `frontend/next.config.ts` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `frontend/next.config.ts` |
| `X-Frame-Options` | `DENY` (legacy twin of `frame-ancestors 'none'`) | `frontend/next.config.ts` |
| `Permissions-Policy` | `tools=(self)` (WebMCP; unchanged) | `frontend/next.config.ts` |

All values come from `frontend/lib/security/headers.ts`.

## Content-Security-Policy

`frontend/proxy.ts` (Next.js 16's `proxy`, formerly `middleware`) creates a random nonce for
every page request. It sets the policy on both the response and the request, because Next.js
reads the nonce from the request's policy and attaches it to its framework and page scripts.
The root layout passes the same nonce to next-themes for its inline theme script.

```
default-src 'self';
script-src 'self' 'nonce-<random>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data: https://*.googleusercontent.com;
font-src 'self';
connect-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

- **Scripts:** only nonced scripts, plus scripts they load (`'strict-dynamic'`), can run. Inline
  event handlers, injected `<script>` tags and `javascript:` URLs are blocked. `next dev` adds
  `'unsafe-eval'`, which React needs to rebuild server error stacks. Production never gets it.
- **Styles:** `'unsafe-inline'` stays, because React `style` attributes (calendar positions,
  charts) and runtime `<style>` tags (toasts) cannot carry a nonce. Putting a nonce in
  `style-src` would also make browsers ignore `'unsafe-inline'`.
- **Images:** Google account avatars are the only remote images.
- **`upgrade-insecure-requests`** is sent only for HTTPS requests, so a local `next start` on
  `http://127.0.0.1` (the CI smoke test) still loads its assets.
- **Dynamic rendering:** the root layout reads the request headers, so every page renders per
  request. A nonce cannot be baked into a prerendered page. The build output marks routes as
  `ƒ (Dynamic)`.
- **WebMCP** registers tools through `document.modelContext`/`navigator.modelContext` from
  the app's own bundle, so the CSP doesn't affect it. Browser-extension content scripts are not
  bound by the page CSP.
- **Analytics:** the app ships no Vercel Analytics or Speed Insights. Adding them later needs
  `https://va.vercel-scripts.com` in `script-src` (loaded by a nonced script) and the
  `/_vercel/insights` endpoint, which is same-origin. On preview deployments, the Vercel
  Toolbar (`vercel.live`) is blocked by this policy. Turn the toolbar off for the project, or
  accept that preview comments don't load.

To find a violation, open the browser console on the deployed site. Blocked resources are
logged with the directive that blocked them.

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
