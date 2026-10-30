# StudyFlow deployment guide

StudyFlow deploys at zero cost per `docs/adr/0005-use-zero-cost-render-and-neon-deployment.md`:

| Concern | Provider | Plan |
| --- | --- | --- |
| API (Dockerized FastAPI) | Render | Free |
| Frontend (React) | Vercel | Hobby |
| PostgreSQL | Neon | Free |
| Authentication email | Resend SMTP relay | Free |

The frontend proxies every API request through its own origin (the Next.js `/api/v1/*` rewrite in
`frontend/next.config.ts`, which reads `BACKEND_ORIGIN`), so the
browser sees a single HTTPS origin as required by SPEC §6.6. Session cookies keep their
`__Host-` prefix, `SameSite=Strict` attributes, and CSRF double-submit design unchanged.

## Environment variables

Application settings use the `STUDYFLOW_` prefix (see `backend/src/studyflow/settings.py`).
Production mode enforces extra validation: explicit database URL with TLS, HTTPS public app
URL, and TLS for email delivery.

| Variable | Required in production | Set by | Notes |
| --- | --- | --- | --- |
| `STUDYFLOW_ENVIRONMENT` | yes | `render.yaml` (`production` for every hosted service) | Enables production validators and secure cookies |
| `STUDYFLOW_TRUSTED_PROXY_HOPS` | yes | `render.yaml` (`3`) | Number of proxies in front of the API that append to `X-Forwarded-For`; see [Client IP addresses](#client-ip-addresses-and-rate-limits) |
| `STUDYFLOW_FRONTEND_PROXY_SECRET` | yes (Render and Vercel) | You (secret, same value on both) | At least 32 random characters shared with the frontend proxy so the API can trust the end-user address it forwards; leave unset locally; see [Client IP addresses](#client-ip-addresses-and-rate-limits) |
| `STUDYFLOW_MIGRATE_ON_START` | no | `render.yaml` (`true` on `studyflow-api-dev`, `false` on `studyflow-api`) | Applies migrations before Uvicorn starts. Set to `false` for `studyflow-api`; see [`release.md`](release.md) |
| `STUDYFLOW_ACCEPTED_NEWER_SCHEMA_REVISIONS` | no | Render Dashboard, temporarily | Comma-separated revisions newer than the build that the boot gate may start on (release window and rollback only); see [`release.md`](release.md) |
| `STUDYFLOW_DATABASE_URL` | yes | You (secret) | Neon **pooled** URL, converted; see below |
| `STUDYFLOW_PUBLIC_APP_URL` | yes | You for dev; `render.yaml` for production (`https://studyflow.vercel.app`) | Frontend origin; verification links point here |
| `STUDYFLOW_SMTP_HOST` | yes | `render.yaml` (`smtp.resend.com`) | |
| `STUDYFLOW_SMTP_PORT` | yes | `render.yaml` (`2587`) | |
| `STUDYFLOW_SMTP_USERNAME` | yes | `render.yaml` (`resend`) | Literal username for Resend's relay |
| `STUDYFLOW_SMTP_PASSWORD` | yes | You (secret) | Resend API key |
| `STUDYFLOW_SMTP_START_TLS` | yes | `render.yaml` (`true`) | Production requires TLS delivery |
| `STUDYFLOW_EMAIL_FROM_ADDRESS` | yes | You (secret) | Must be an address on a Resend-verified domain |
| `STUDYFLOW_CORS_ORIGINS` | no | You for dev and production | Comma-separated origins for direct frontend calls; the production proxy normally avoids this. Origins are compared and stored the way browsers send `Origin` (lowercase, default `:443`/`:80` omitted). In production every origin must be HTTPS and equal to the `STUDYFLOW_PUBLIC_APP_URL` origin, or startup fails |
| `STUDYFLOW_GOOGLE_OIDC_CLIENT_ID` | no | You (secret) | All three OIDC values configure together |
| `STUDYFLOW_GOOGLE_OIDC_CLIENT_SECRET` | no | You (secret) | |
| `STUDYFLOW_GOOGLE_OIDC_REDIRECT_URI` | no | You (secret) | Paste `https://<frontend-origin>/api/v1/auth/google/callback`; must be HTTPS and must go through the frontend proxy |
| `STUDYFLOW_GOOGLE_IMPORT_REDIRECT_URI` | no | You (secret) | Enables Google Calendar and Classroom import. Paste `https://<frontend-origin>/api/v1/integrations/google/callback`; requires the three OIDC values. See [google-import-setup.md](google-import-setup.md) |

## Client IP addresses and rate limits

Registration, login, password reset, verification resend, Google sign-in and Google import are
rate limited per client IP address (`backend/src/studyflow/auth/rate_limits.py`). The API never
lets Uvicorn rewrite the client address from proxy headers: the Dockerfile starts Uvicorn with
`--no-proxy-headers`, and `FORWARDED_ALLOW_IPS` is not used. Trusting every source address
(`FORWARDED_ALLOW_IPS=0.0.0.0/0` or `*`) makes Uvicorn take the **left-most**
`X-Forwarded-For` entry, which the client writes itself, so any request could pick a new IP and
bypass every per-IP limit.

Instead, `studyflow.api.client_ip.request_client_ip` reads `X-Forwarded-For` from the right.
Each proxy appends the address that connected to it, so only the right-most
`STUDYFLOW_TRUSTED_PROXY_HOPS` entries come from infrastructure in front of the API, and the
entry that many positions from the right is the address that connected to the outermost trusted
proxy. Anything further left is ignored. If the header is missing, too short or malformed, the
TCP peer address is used.

- **Render: `3`.** Requests pass through Cloudflare, which appends the connecting address, then
  Render's proxy, which appends the Cloudflare edge address, then a Render-internal proxy, which
  appends a `10.x` address. None of them strips a value the client sent. A header-echo service on
  Render showed `client, Cloudflare edge, 10.x` on every request (30 October 2026). With `2`, the
  API would key every caller on a Cloudflare edge address, which changes between requests.
- **Local development, tests and `docker compose`: `0` (default).** `X-Forwarded-For` is
  ignored and the socket peer address is used.
- Raise the value only if another proxy that appends to `X-Forwarded-For` is added in front of
  Render, and never set it higher than the number of proxies actually present: a value that is
  too high reads a client-controlled entry again.

### Browser traffic through the frontend proxy

Browser requests reach the API through the frontend's same-origin proxy, so the hop logic above
only sees a Vercel egress address, which many unrelated users share. Counting that address
would let five sign-ups from anyone behind it lock everyone else out for 15 minutes.

The frontend therefore forwards the end-user address itself (`frontend/proxy.ts`,
`frontend/lib/api-proxy.ts`):

- The Next.js Proxy handles `/api/v1/*`, drops any client-supplied `x-studyflow-client-ip` and
  `x-studyflow-proxy-secret` headers, and rewrites the request to `BACKEND_ORIGIN`.
- Only when it runs on Vercel (`VERCEL=1`) and `STUDYFLOW_FRONTEND_PROXY_SECRET` is set, it adds
  `x-studyflow-client-ip` from Vercel's `x-real-ip` (falling back to `x-vercel-forwarded-for`),
  which Vercel overwrites with the connecting address, plus `x-studyflow-proxy-secret`.
- The API uses `x-studyflow-client-ip` only when exactly one `x-studyflow-proxy-secret` header
  matches its own `STUDYFLOW_FRONTEND_PROXY_SECRET` (constant-time comparison) and the address is
  well formed. Otherwise it falls back to the proxy hops, so callers that do not know the secret,
  including direct calls to the Render URL, cannot choose their own rate-limit key.

To enable it, generate one value (for example `openssl rand -base64 48`) and set it as
`STUDYFLOW_FRONTEND_PROXY_SECRET` on both Render services (dashboard, `sync: false`) and on the
Vercel project (Production and Preview environments, not prefixed with `NEXT_PUBLIC_`), then
redeploy both. `BACKEND_ORIGIN` must be available to the Vercel runtime as well as the build,
because the Proxy reads it per request. Rotate by changing both sides together; while they
differ, browser traffic falls back to per-egress-address limits. Leave the variable unset for
local development, tests and `docker compose`.

## One-time setup

### 1. Neon (PostgreSQL)

1. Create a project and choose a region near your users.
2. Copy the **pooled** connection string (hostname contains `-pooler`).
3. Convert it before pasting into Render:
   - Scheme must become `postgresql+psycopg`
   - Append `?sslmode=require`
   - Percent-encode reserved characters in the password (`@` → `%40`, etc.)

   ```
   postgresql+psycopg://USER:PASSWORD@ep-XXXX-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```

### 2. Resend (authentication email)

1. Create an API key. It becomes `STUDYFLOW_SMTP_PASSWORD`.
2. Register the sending domain/subdomain (for example `studyflow.vethya.com`) and add the
   DKIM/SPF DNS records Resend displays. Wait until verification shows verified.
3. The from-address decides which verified domain sends; nothing else selects it.
4. Choose the final from-address now; it becomes `STUDYFLOW_EMAIL_FROM_ADDRESS`.

### 3. Render (API)

1. Push this repository to GitHub and connect the Render workspace.
2. Create a **Blueprint** deployment from the repository root so `render.yaml` applies:
   - Project `StudyFlow`
   - `Production`: `studyflow-api` from `master` (this name intentionally matches the existing service)
   - `dev`: `studyflow-api-dev` from `dev`
   Each service uses Docker, the free plan, a health check, and its own environment variables.
   Render checks `/api/v1/health`, which does not access PostgreSQL. Use `/api/v1/ready` separately
   when you need to verify database connectivity.
   Render's pre-deploy command only exists on paid instance types, so the release gate lives in
   the Dockerfile `CMD`: `python -m studyflow.cli.release boot` runs before Uvicorn. It validates
   the settings and refuses to start while the database is behind this build's migrations. A
   failed start fails the deploy, and Render keeps serving the previous deploy. The gate applies
   migrations itself only when `STUDYFLOW_MIGRATE_ON_START=true`, which the Blueprint sets for
   `studyflow-api-dev` only. Production has `autoDeployTrigger: "off"`, so merging to `master`
   does not deploy, provided the Blueprint's Auto Sync is off: a Blueprint sync redeploys
   services whose `render.yaml` entry changed regardless of `autoDeployTrigger`. Production schema changes and deploys follow [`release.md`](release.md).
   The Blueprint leaves `dockerCommand` unset so Render uses that `CMD` without reparsing its
   shell quoting. The schema check runs on every cold start and costs one short query.
3. Keep the existing production secret values. Configure separate values for production and dev,
   especially separate Neon databases. `sync: false` values for newly added services may need to
   be entered manually after syncing an existing Blueprint:
   - `STUDYFLOW_DATABASE_URL` (converted Neon URL from step 1)
   - `STUDYFLOW_PUBLIC_APP_URL` for dev: set the HTTPS frontend origin. Left unset, it falls back
     to `http://localhost:3000`, which production validation rejects
   - `STUDYFLOW_CORS_ORIGINS`: normally leave empty, because the frontend proxy keeps the browser
     on one origin. Production accepts only the HTTPS origin of `STUDYFLOW_PUBLIC_APP_URL`
   - `STUDYFLOW_SMTP_PASSWORD` and `STUDYFLOW_EMAIL_FROM_ADDRESS`
   - all three Google OIDC variables together, if Google Sign-In is enabled
   All hosted services use production mode so cookies retain their `Secure` attribute and
   `__Host-` prefix. The shared frontend currently proxies to the dev service, so production
   authentication remains inactive until it gets a matching frontend deployment.
4. Note the production service URL (for example `https://studyflow-api.onrender.com`). If Google
   Sign-In will be used, register
   `https://studyflow.vercel.app/api/v1/auth/google/callback` in the Google Cloud console,
   then fill all three OIDC variables together — leaving any one blank while the others are
   set fails startup validation by design. The callback must go through the frontend origin:
   the OIDC state cookie is set on the origin where sign-in started (the Vercel proxy), so a
   callback sent directly to the Render domain would arrive without it and every login would
   be rejected.

### 4. Vercel (frontend)

The frontend is a Next.js app in `frontend/`. Its `/api/v1/*` rewrite lives in
`frontend/next.config.ts` and forwards to the `BACKEND_ORIGIN` environment variable, so cookies
stay on the frontend origin. Do not add a `vercel.json` (or a rewrite in the Vercel dashboard)
for `/api/*`: a Vercel-level rewrite to a fixed Render URL runs before the Next.js rewrite and
silently overrides `BACKEND_ORIGIN`.

1. Import the repository into Vercel with the project name `studyflow` and the root directory
   `frontend`.
2. Set `BACKEND_ORIGIN` in the Vercel project's environment variables to the API service that
   environment should use, for example `https://studyflow-api.onrender.com`. Environment
   variable changes only apply to new deployments.
3. Application code calls `/api/...` relative to its own origin everywhere — never an
   absolute backend URL.

## Separate dev and production frontends

Until this split is done, the shared frontend (`https://studyflow.vercel.app`) proxies to
`studyflow-api-dev`. Every push to `dev` therefore reaches real users, and dev's verification
and password-reset emails link to the production frontend. The Blueprint no longer hardcodes
dev's `STUDYFLOW_PUBLIC_APP_URL` and `STUDYFLOW_CORS_ORIGINS`. Both are `sync: false`, so each
team chooses dev's frontend origin itself.

Render keeps the current value of an existing `sync: false` variable after a Blueprint sync.
Until you change them, `studyflow-api-dev` keeps `https://studyflow.vercel.app`.

### 0. Remove any fixed `/api` rewrite

Earlier versions of this guide told operators to commit a `vercel.json` that rewrote
`/api/:path*` to a fixed Render URL. If the deployed Vercel project still has one (in the
deployed root directory or as a dashboard rewrite), it routes `/api/v1/*` before the Next.js
rewrite, so changing `BACKEND_ORIGIN` below would have no effect and a dev preview could keep
reaching production, or production could stay on dev. Delete that rule, redeploy, and confirm
that `/api/v1/health` still answers through the frontend origin before continuing.

### 1. Give dev its own frontend origin

1. Pick a dev frontend origin, for example the Vercel branch domain of the `dev` branch or a
   second Vercel project. The frontend's `/api/v1/*` rewrite (`frontend/next.config.ts`) reads
   `BACKEND_ORIGIN`. In Vercel, set `BACKEND_ORIGIN=https://studyflow-api-dev.onrender.com` for
   the Preview environment, scoped to the `dev` branch, so only the dev frontend talks to the dev
   service.
2. In the Render Dashboard, set these on `studyflow-api-dev`:
   - `STUDYFLOW_PUBLIC_APP_URL` to the dev frontend origin, with no path.
   - `STUDYFLOW_CORS_ORIGINS` to empty. The rewrite keeps the browser on one origin. The
     dev service runs in production mode and rejects a mismatch with `STUDYFLOW_PUBLIC_APP_URL`
     at startup. Clear `STUDYFLOW_CORS_ORIGINS` before changing `STUDYFLOW_PUBLIC_APP_URL`, or
     save both values together, so the dev service can start.
   - If dev uses Google sign-in or import, set the full callback URIs on the dev frontend
     origin and register both in the Google Cloud console:
     - `STUDYFLOW_GOOGLE_OIDC_REDIRECT_URI=https://<dev-frontend-origin>/api/v1/auth/google/callback`
     - `STUDYFLOW_GOOGLE_IMPORT_REDIRECT_URI=https://<dev-frontend-origin>/api/v1/integrations/google/callback`
3. Redeploy `studyflow-api-dev`. Then confirm that a verification email from dev links to the dev
   frontend.

### 2. Repoint the production frontend at `studyflow-api`

Do this only after the production database is migrated and verified (see the release runbook,
if present), and after deciding what happens to the accounts that currently live in the dev
database.

1. In the Vercel project's **Production** environment variables, change `BACKEND_ORIGIN` from
   `https://studyflow-api-dev.onrender.com` to `https://studyflow-api.onrender.com`, then
   redeploy production. Environment variable changes only apply to new deployments.
2. Check `studyflow-api`'s variables: `STUDYFLOW_PUBLIC_APP_URL=https://studyflow.vercel.app`,
   `STUDYFLOW_CORS_ORIGINS` empty, and Google redirect URIs on `https://studyflow.vercel.app`.
3. Run the post-deployment checklist below against `https://studyflow.vercel.app`. Existing
   sessions from the dev service will not be valid on production, so users sign in again.
4. Rollback: changing `BACKEND_ORIGIN` alone is not enough, because after step 1 the dev
   service's origin-dependent settings point at the dev frontend. Google state cookies set on
   `https://studyflow.vercel.app` would be redirected to the dev frontend, and emails would link
   there. To roll back:
   1. On `studyflow-api-dev`, set `STUDYFLOW_PUBLIC_APP_URL=https://studyflow.vercel.app` and
      both Google redirect URIs back to
      `https://studyflow.vercel.app/api/v1/auth/google/callback` and
      `https://studyflow.vercel.app/api/v1/integrations/google/callback`, then redeploy it.
   2. Set the Vercel **Production** `BACKEND_ORIGIN` back to
      `https://studyflow-api-dev.onrender.com` and redeploy the frontend.
   3. The dev frontend shares the dev service again until you redo step 1, so treat dev pushes
      as reaching real users in the meantime.

## Local development

Frontend developers do not need Python or Docker installed to try the deployed API, but
direct cross-site browser calls cannot carry `SameSite=Strict` session cookies regardless of
CORS settings. Two supported options:

- **Full stack locally** (`docker compose up`): `localhost:3000` and `localhost:8000` are
  different origins but the same site, so cookies flow once
  `STUDYFLOW_CORS_ORIGINS=http://localhost:3000` is set.
- **Local proxy against any backend** (recommended): run the Next.js rewrite with
  `destination` pointed either at `http://127.0.0.1:8000` or at the deployed Render URL.
  Same-origin requests need no CORS configuration and behave exactly like production.

Postman and curl are unaffected by cookie site rules; import
`postman/StudyFlow.postman_collection.json` and select the matching environment file.

## Post-deployment verification checklist

1. `GET https://<api-host>/api/v1/health` returns `200`.
2. `GET https://<api-host>/api/v1/ready` returns `200` (Neon reachable over TLS).
3. `GET https://studyflow.vercel.app/api/v1/health` returns `200` (rewrite works, same origin).
4. Register an account through the frontend; the verification email arrives from the
   verified Resend domain; verifying enables login.
5. Log in; authenticated calls succeed with cookies + `X-CSRF-Token` (no CORS errors,
   no silent 401s).
6. Run the Postman collection against the deployed base URL.

## Known limitations

- **Render Free cold start:** the service sleeps after ~15 minutes idle; the first request
  takes roughly 30–60 seconds while it wakes. SPEC §19.2 excludes cold-start latency from
  warm performance measurements; wake the service before demonstrations.
- **Neon auto-suspend:** the free compute resumes after inactivity, adding latency to the
  first query after idle. Combined with Render's wake-up, allow up to a couple of minutes
  after long idleness.
- **Free-tier data expiry does not apply** to Neon, unlike Render Postgres (rejected in
  SPEC §25).

## Backups

SPEC §20.8 requires a manual backup before each review/demo plus at least one documented
restore test. Use the cross-platform procedure in [`docs/backup-restore.md`](backup-restore.md).
The repository contains the backup scripts, but never the database dump, database password,
Google OAuth token, or age private key.
