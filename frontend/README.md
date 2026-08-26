# StudyFlow frontend

Next.js 16 (App Router) client for the StudyFlow API.

## What this app is

The backend stores coursework, availability windows and account settings. It
does **not** schedule study sessions — there is no scheduling endpoint, no
session record, and no logged-effort tracking.

So the product is not a scheduler. It answers one question the stored data can
genuinely answer:

> Does the coursework I owe fit in the study time I actually have?

Weekly availability windows minus blocked-out periods gives capacity. Open
tasks due inside a horizon give commitment. The difference is the headline
figure on the dashboard, and the reason the interface is otherwise monochrome:
colour is reserved for surplus and deficit, and means nothing else.

## Running locally

The browser talks to the backend at `/api/v1/*` on this app's **own** origin;
`next.config.ts` proxies through to FastAPI. Keeping one origin means the
`SameSite=Strict` session cookie is always sent, and no CORS setup is needed.

1. Start the backend from the repository root:

   ```bash
   docker compose up -d
   ```

   API on `http://localhost:8000`; Mailpit catches outgoing mail on
   `http://localhost:8025`, which is where verification and reset links land.

2. Point the backend's redirects at this app. In the root `.env`:

   ```
   STUDYFLOW_PUBLIC_APP_URL=http://localhost:3000
   ```

3. Start the frontend:

   ```bash
   pnpm install && pnpm dev
   ```

Set `BACKEND_ORIGIN` in `frontend/.env.local` if the backend is not on
`http://localhost:8000`. See `.env.example`.

## Screens

| Route | What it shows |
| --- | --- |
| `/dashboard` | Capacity vs. commitment over 7/14/30 days, what is next, overdue work, time by course |
| `/tasks` | Coursework ledger with server-side status, category, priority and course filters |
| `/tasks/[taskId]` | One task in full, with start / finish early / edit / delete |
| `/calendar` | Month grid: deadlines against the study hours each day actually holds |
| `/availability` | Weekly windows and one-off exceptions, both editable |
| `/settings/*` | Profile, security, preferences, timezone, and service status |

There is no Progress screen. Every chart it would have needed depends on logged
study effort, which the backend does not record.

## Endpoint coverage

The API exposes 35 endpoints. 33 are reached from the interface. The two that
are not, deliberately:

- `GET /auth/google/callback` — the browser is redirected here by Google;
  JavaScript must never call it. The frontend's job is to host the routes it
  redirects *to*: `/app`, `/login/google-link`, `/login/google-error/[reason]`.
- `POST /auth/google/link` — the non-browser variant, which takes the link
  challenge in the request body. Browsers use `/auth/google/link/browser`,
  where the challenge stays in an httpOnly cookie.

## Layout

| Path | Purpose |
| --- | --- |
| `lib/api/` | Typed client — one module per backend router |
| `lib/api/wire.ts` | Response shapes exactly as FastAPI serialises them |
| `lib/api/mappers.ts` | snake_case ⇄ camelCase, enum and weekday translation |
| `lib/capacity.ts` | Availability and commitment arithmetic |
| `components/capacity-bar.tsx` | The overflow bar the dashboard is built around |
| `hooks/use-session.tsx` | Who is signed in; sign out |
| `hooks/use-api.ts` | Load-on-mount fetching with abort and reload |

Authentication is a server-managed browser session. The backend sets an
httpOnly session cookie plus a JS-readable CSRF cookie; `lib/api/client.ts`
echoes the latter back as `X-CSRF-Token` on every mutating request.

Registration is email-first and takes three calls: `POST /auth/register` with
an address, `POST /auth/verify-email` to exchange the emailed token for a
signup token, then `POST /auth/complete-registration`. `/register` and
`/verify-email` implement that sequence.

## Known assumption

Availability weekdays are indexed 0–6, but the backend does not document which
day is 0. The client assumes **0 = Monday** (Python's `datetime.weekday()`) and
converts in `lib/api/mappers.ts`. If that is wrong, every window lands one day
out; the fix is the two helpers in that file and nothing else.

Capacity arithmetic runs in the browser's local timezone. Windows are stored
against the account's configured zone, so a mismatch shifts the figures — the
timezone settings page flags it when the two disagree.
