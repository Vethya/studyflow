# StudyFlow frontend

Next.js 16 (App Router) client for the StudyFlow API.

## Running locally

The frontend talks to the FastAPI backend at `/api/v1/*` on its **own** origin.
`next.config.ts` proxies those requests to the backend, so both sides look
same-origin to the browser. That matters for two reasons:

- the session cookie is `SameSite=Strict` and would not be sent cross-site;
- no CORS configuration is needed on the backend for local development.

1. Start the backend from the repository root:

   ```bash
   docker compose up -d
   ```

   It listens on `http://localhost:8000`, and Mailpit catches outgoing mail at
   `http://localhost:8025` — that is where the verification and password-reset
   links land.

2. Point the backend at this app so its emails and OAuth redirects come back
   here. In the root `.env`:

   ```
   STUDYFLOW_PUBLIC_APP_URL=http://localhost:3000
   ```

3. Start the frontend:

   ```bash
   pnpm install && pnpm dev
   ```

Set `BACKEND_ORIGIN` in `frontend/.env.local` if the backend is not on
`http://localhost:8000`. See `.env.example`.

## Layout

| Path | Purpose |
| --- | --- |
| `lib/api/` | Typed API client — one module per backend router |
| `lib/api/wire.ts` | Response shapes exactly as FastAPI serialises them |
| `lib/api/mappers.ts` | snake_case ⇄ camelCase, enum and weekday translation |
| `hooks/use-session.tsx` | Session context: who is signed in, sign out |
| `hooks/use-api.ts` | Load-on-mount data fetching with abort and reload |
| `types/` | Domain types the UI is written against |

Authentication is a server-managed browser session. The backend sets an
httpOnly session cookie plus a JS-readable CSRF cookie; `lib/api/client.ts`
echoes the latter back in an `X-CSRF-Token` header on every mutating request.

## What is wired, and what is not

The backend currently exposes authentication, account, academic tasks and
availability. It has **no scheduling or study-session endpoints**, so anything
derived from study sessions is still fixture data and is labelled as such in
the UI.

| Page | Status |
| --- | --- |
| Login, register, verify email, reset password | Live |
| Tasks | Live — list, create, edit, start, finish early, delete |
| Availability | Live — windows and unavailable periods |
| Settings (profile, preferences, security, timezone) | Live |
| Dashboard | Tasks and deadlines live; sessions, charts and effort totals are fixtures |
| Calendar | Availability shading and overdue list live; session blocks are fixtures |
| Progress | Per-task table live; totals and charts are fixtures |

Registration is email-first and takes three calls: `POST /auth/register` with
an address, `POST /auth/verify-email` to exchange the emailed token for a
signup token, then `POST /auth/complete-registration` with the name, password
and timezone. `/register` and `/verify-email` implement that sequence — the
second page switches between "waiting for the email" and "finish your account"
depending on whether a `?token=` is present.
