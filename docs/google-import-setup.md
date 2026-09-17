# Google Calendar and Google Classroom import: setup

Status: 2026-09-18. Audience: whoever manages the StudyFlow Google Cloud project and Render.

The import reuses the **same Google Cloud project and OAuth client as Google Sign-In**. It needs two
APIs enabled, three read-only scopes, one more redirect URI, and one new environment variable. It
costs nothing: standard use of the Calendar and Classroom APIs has no charge, and a thesis-sized
app stays far below the free quotas.

## What the feature does (for the reviewer)

| | Google Calendar | Google Classroom |
|---|---|---|
| Starts from | Availability → **Import from Google Calendar** | Tasks → **Import from Google Classroom** |
| Reads | Events in the student's primary calendar for 2 weeks to 3 months | Active classes, published coursework, and the student's own submission state |
| Creates | Blocked time (unavailable periods) for the events the student ticks | Tasks for the coursework the student ticks, with their own estimate |
| Scopes | `calendar.events.readonly` | `classroom.courses.readonly`, `classroom.coursework.me.readonly` |

Security design, in short:

- The authorization-code flow uses **PKCE (S256)** plus the client secret. The OAuth `state` is random,
  single-use, bound to the signed-in account, stored only as a hash, and valid for 10 minutes. It is
  mirrored in an HttpOnly `SameSite=Lax` cookie, so the callback only works in the browser that
  started it.
- Only **read-only** scopes are requested, with `include_granted_scopes=false`, so the token carries
  nothing else. If the student unticks a permission, the import stops with a clear message.
- **No Google token is stored.** `access_type=online` means Google issues no refresh token. The access
  token is used once inside the callback and then discarded.
- Google's data is reduced to a few fields and kept as a preview for at most **30 minutes**. Nothing
  becomes a task or blocked time until the student confirms, and each preview can be confirmed once.
- The start endpoint needs a session and CSRF token and is rate-limited (10 per 15 minutes per
  account and IP). All data cascades on account deletion.

## 1. Enable the two APIs

Google Cloud Console → select the StudyFlow project (the one that owns the Sign-In OAuth client).

1. **APIs & Services → Library**.
2. Search **Google Calendar API** → **Enable**.
3. Search **Google Classroom API** → **Enable**.

If either is not enabled, the import ends on StudyFlow's "not set up on this server" page.

## 2. Add the read-only scopes

**Google Auth Platform → Data Access → Add or remove scopes**. Under "Manually add scopes", paste:

```
https://www.googleapis.com/auth/calendar.events.readonly
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.coursework.me.readonly
```

Choose **Add to table → Update → Save**. Google lists all three as **sensitive** scopes. Sign-In
itself still asks only for `openid email profile`, so the sign-in screen does not change.

## 3. Add the import redirect URIs

**Google Auth Platform → Clients →** open the existing **Web application** client used for Sign-In.
Under **Authorized redirect URIs**, add one entry per place StudyFlow runs. Keep the existing
`/api/v1/auth/google/callback` entries.

```
https://studyflow.vercel.app/api/v1/integrations/google/callback
http://localhost:3000/api/v1/integrations/google/callback
```

Add another line for any other frontend origin students use, such as a separate development
deployment. The URI must use the **frontend origin**, the same host as `STUDYFLOW_PUBLIC_APP_URL`,
because `/api/v1` is proxied to Render and the import cookie belongs to that host. **Save**.
Google can take a few minutes to apply the change.

## 4. Branding and audience

**Google Auth Platform → Branding.** Check that these are filled in:

- App name `StudyFlow`, user support email, developer contact email.
- App home page: `https://studyflow.vercel.app`
- Privacy policy: `https://studyflow.vercel.app/privacy`
- Terms of service: `https://studyflow.vercel.app/terms`

**Google Auth Platform → Audience.** The user type is **External**. Then choose one:

- **Testing (recommended for the thesis).** Add every account that will try the import, such as the
  team, the supervisor, and usability-study students, under **Test users**, up to 100. Other
  accounts are refused by Google.
- **In production, not verified.** Anyone can use it, but Google shows an "unverified app" warning
  for the import and caps it at 100 users over the project's lifetime. Sign-In is not affected.

Full verification removes the warning and the cap. It is free but slow, and it needs a domain you
own; `vercel.app` does not qualify. See step 7.

## 5. Configure Render

In each Render service that should offer imports (development and production), add:

| Key | Value |
|---|---|
| `STUDYFLOW_GOOGLE_IMPORT_REDIRECT_URI` | `https://studyflow.vercel.app/api/v1/integrations/google/callback`, exactly as registered in step 3 |

The three `STUDYFLOW_GOOGLE_OIDC_*` values must already be set, because the import reuses that client
ID and secret. Production refuses a non-HTTPS URI. Save, then redeploy. The container runs
`alembic upgrade head` on start, which applies migration `20260918_22` (two short-lived tables and
two nullable columns).

For local Docker Compose, put the variable in `.env` with the `http://localhost:3000/...` value.

## 6. Check it works

1. Sign in to StudyFlow with an account that is a test user.
2. **Availability** should show **Import from Google Calendar**, and **Tasks** should show
   **Import from Google Classroom**. If the buttons are missing, the backend is not configured:
   `GET /api/v1/integrations/google/status` returns `{"configured": false}`.
3. Run each import, tick a few items, and confirm. Blocked time appears on Availability, and tasks
   appear on Tasks.
4. Import again: items already imported are marked as such and are not duplicated.

## 7. Optional: full Google verification

Only needed for more than 100 users, or to remove the warning.

1. Put StudyFlow on a domain you own and verify it in Google Search Console. Host the privacy policy
   there.
2. **Google Auth Platform → Verification Center → Prepare for verification.**
3. For each scope, give a justification. Suggested text:
   - `calendar.events.readonly`: *"Students choose to import events from their primary Google
     Calendar once, so StudyFlow does not schedule study sessions when they are busy. Selected events
     become blocked time. Nothing is written to Google and no token is stored."*
   - `classroom.courses.readonly`: *"Used to list the student's active classes, so coursework can be
     shown with its class name when the student imports it."*
   - `classroom.coursework.me.readonly`: *"Students choose to import their own coursework that has a
     due date and is not turned in, so it can become a planned task with a deadline. Read once, only
     after the student starts the import."*
4. Upload a short unlisted video showing the consent screen, the review page, and the imported
   blocked time and tasks.

## Troubleshooting

| What the student sees | Likely cause | Fix |
|---|---|---|
| No import buttons | `STUDYFLOW_GOOGLE_IMPORT_REDIRECT_URI` or an OIDC value is missing | Step 5, then redeploy |
| Google error page `redirect_uri_mismatch` | The URI in Render differs from the one registered | Make steps 3 and 5 identical, including `https` and the path |
| Google error "Access blocked: app has not completed verification" or "not a test user" | Testing mode and the account is not a test user | Add it under Audience → Test users |
| StudyFlow "not set up on this server" | An API is not enabled, or the client secret is wrong | Step 1; check `STUDYFLOW_GOOGLE_OIDC_CLIENT_SECRET` |
| StudyFlow "did not get the access it needs" | A permission box was unticked, or a school admin blocks the app | Import again with all boxes ticked. School Workspace admins can allow StudyFlow under Security → API controls |
| StudyFlow "could not be completed" | The 10-minute window passed, or the import was finished in another browser | Start again from the same tab |
| "This import has expired or was already used" | More than 30 minutes passed, or it was already confirmed | Start a new import |

## Where the code is

- Backend: `backend/src/studyflow/integrations/` (service, Google client, repository),
  `backend/src/studyflow/api/google_import.py`, and migration
  `backend/migrations/versions/20260918_22_google_import.py`.
- Frontend: `frontend/components/google-import-button.tsx`, `frontend/app/(app)/import/google/`,
  and `frontend/lib/api/google-import.ts`.
- Requirements: SPEC §8.5, `docs/data-inventory.md`, and `/privacy`.
