# StudyFlow frontend

Next.js 16 (App Router) client for the StudyFlow API.

## What this app is

StudyFlow combines coursework, availability, generated study sessions, and confirmed outcomes.
Students can record Completed, Delayed, or Missed sessions and review proposed schedule revisions.
Capacity views explain whether upcoming coursework fits the available time. Adaptive estimates
use the student's own completed-task history while preserving their original estimate.

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

## NFR-05 browser evidence

Run the automated compatibility and accessibility evidence suite from this
directory:

```bash
pnpm test:nfr05:install
pnpm test:nfr05
```

The suite exercises 360, 768, and 1440 CSS-pixel viewports across stable
Chrome, Edge, Playwright WebKit, mobile Chrome emulation, and mobile Safari
emulation. It also checks core route rendering, horizontal overflow, runtime
errors, control names, keyboard focus, labels, contrast, and non-color status
cues. Results are written to `test-results/nfr05/evidence.md`, with the
interactive report in `playwright-report/`.

The Chrome and Edge projects use the locally installed stable applications;
install Edge separately if it is not present.

Playwright WebKit is not Apple Safari. Complete
`../docs/nfr05-mobile-safari-checklist.md` on a real iPhone to close the mobile
Safari evidence requirement.

## Screens

| Route | What it shows |
| --- | --- |
| `/dashboard` | Capacity vs. commitment over 7/14/30 days, what is next, overdue work, time by course |
| `/tasks` | Coursework ledger with server-side status, category, priority and course filters |
| `/tasks/[taskId]` | One task in full, with start / finish early / edit / delete |
| `/calendar` | Sessions, deadlines, schedule proposals, and session outcomes |
| `/progress` | Confirmed study effort and outcome history; no prediction-accuracy metrics |
| `/availability` | Weekly windows and one-off exceptions, both editable |
| `/settings/*` | Profile, security, preferences, timezone, and service status |

## Endpoint coverage

The typed client covers task, availability, scheduling, outcome, account, and adaptive-estimate
workflows. Two authentication endpoints are intentionally not directly called by JavaScript:

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

Availability weekdays are indexed 0–6 with **0 = Monday**, matching the backend's weekly model.
The client translates weekdays in `lib/api/mappers.ts`.

Capacity arithmetic runs in the browser's local timezone. Windows are stored
against the account's configured zone, so a mismatch shifts the figures — the
timezone settings page flags it when the two disagree.

## Adaptive task forms

The form requests `GET /api/v1/adaptive-estimates/preview` for the selected category and original
minutes. Unavailable previews remain on Original and hide internal predictions. Five eligible
completed tasks start chronological hidden prediction capture; at least five later completed
predictions must qualify before suggestions appear. Category history falls back to overall
history when fewer than five category examples exist. The backend owns this evidence gate.

A qualified suggestion defaults to Adaptive for a new task. Students may choose Original;
editing a saved task preserves its saved choice instead of adopting a new preview default.
Large adjustments ask for acknowledgment through
`POST /api/v1/adaptive-estimates/acknowledgments` before Adaptive can be chosen. The saved task
view distinguishes original, adaptive, and planned minutes. Planned equals the chosen source;
it does not overwrite the original. Accuracy metrics remain internal and are not shown.

## Verify

```bash
pnpm test
pnpm lint
pnpm build
```

Browser-check desktop and 360px widths against disposable local data: cold start, hidden
prediction capture, qualification after ten chronologically seeded completed tasks, category
fallback, Adaptive default, Original override, large-adjustment acknowledgment, saved estimate
fields, and all three session outcomes. Unit tests do not replace this end-to-end check.
