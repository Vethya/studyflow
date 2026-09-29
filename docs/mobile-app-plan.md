# StudyFlow mobile app plan

Status: implementation started on `feature/mobile-app`.

## Product scope

The mobile app targets Android and iOS with full parity with the authenticated
web product. It excludes the landing/marketing pages, privacy/terms pages, and
support pages.

Included:

- Email/password authentication, verification, recovery, and Google Sign-In.
- Native onboarding, Dashboard, Academic Tasks, Calendar, Study Sessions,
  Session Outcomes, Availability, Schedule Revisions, Progress, Settings,
  account deletion, and Google Calendar/Classroom import.
- Adaptive Estimates, Overload, Unscheduled Work, and all existing web rules.
- Deep links from email, web, and OAuth flows.

Deferred from v1:

- Push notifications.
- Native device-calendar integration.
- Offline writes and offline scheduling.
- Biometric unlock.
- App update management, OTA updates, beta programs, CD, and store submission
  automation.

## Technical decisions

- Expo + React Native + TypeScript.
- Expo Router for navigation and deep links.
- Stable NativeWind for native styling, backed by shared StudyFlow design
  tokens. Native components are rewritten with React Native primitives; web
  JSX is not copied directly.
- TanStack Query for server state, foreground refetching, pull-to-refresh,
  and persisted read-only cache. Persist cache for up to 24 hours; clear it on
  logout. `AsyncStorage` is for cache, never tokens.
- React Hook Form for complex forms and Zod for shared runtime validation.
- Reanimated and Gesture Handler for UI-thread motion and gestures.
- No global client-state library in v1. Use TanStack Query for server state and
  focused React context/local state for session, theme, onboarding, and UI.
- If a real cross-screen client-state problem appears later, use Zustand.
- Keep the existing `/api/v1` backend. Add mobile authentication endpoints
  and preserve backward compatibility during rollout.
- Mobile authentication uses system-browser OAuth, PKCE, deep links, short-
  lived access tokens, and rotating refresh tokens stored in secure device
  storage.
- Google native auth/import callbacks use HTTPS backend redirect endpoints and
  return to the app through the `studyflow://` scheme. Configure
  `STUDYFLOW_GOOGLE_MOBILE_OIDC_REDIRECT_URI` and
  `STUDYFLOW_GOOGLE_MOBILE_IMPORT_REDIRECT_URI` in the backend and register
  both URLs in the Google OAuth client before enabling those flows.
- CI only in v1: type-checking, linting, and Expo configuration validation.
  No automated builds, submissions, OTA updates, or CD.

## Repository shape

```text
studyflow/
  frontend/                 # Existing Next.js app
  mobile/                   # Expo React Native app
  packages/
    api/                    # Shared API contracts and mappers
    domain/                 # Shared validation, enums, date/time rules
    design-tokens/          # Shared colors, type, spacing, radii, motion
  pnpm-workspace.yaml
```

Web and mobile share pure TypeScript, API contracts, domain rules, query-key
conventions, and design tokens. They keep separate UI components, navigation,
authentication transports, and storage adapters.

## Navigation and interaction model

Root tabs:

1. Dashboard
2. Tasks
3. Calendar
4. Availability
5. Progress

The account avatar is in the top-right header. It opens a native bottom sheet
with account identity, Appearance, onboarding restart, Settings, and Log out.
The bottom tab bar is hidden on pushed detail and form screens. Each root tab
preserves its own stack, filters, and scroll position.

The large task-search popup keeps the current screen visible behind a dimmed
overlay. Settings search is separate and filters the Settings page in place.

Presentation rules:

- Native system alerts: destructive actions, blocking authentication errors,
  and unsaved-change confirmations.
- Bottom sheets: account menu, filters, session details, Session Outcome, and
  short contextual actions.
- Full-screen stack screens: task forms/details, Schedule Revision review,
  Availability editing, Settings subpages, and Google import.
- Swipe-to-dismiss is enabled for lightweight sheets and search. Long or dirty
  forms require explicit back handling.
- Swipe-to-delete is supported on task rows and availability rows, followed by
  native confirmation.
- Recoverable API errors stay inline with Retry and preserve form input.
- Success uses short non-blocking feedback and optional haptics.

## Screen adaptations

- Dashboard: one vertical scroll; next Study Session first, then capacity,
  overdue/at-risk work, deadlines, and Getting Started.
- Tasks: virtualized vertical list; large search popup; filter bottom sheet;
  active filters remain removable chips; row menu exposes Start, Edit, Finish
  early, and Delete.
- Calendar: today by default; one-day timeline on phones; previous/next controls
  plus a native date picker; session taps open the shared outcome sheet.
- Availability: horizontal Mon–Sun selector; one day timeline at a time;
  swipe between days; full-screen add/edit forms; weekly recurrence remains
  unchanged.
- Progress: compact two-column summary grid and vertical progress rows.
- Settings: native list, pushed category screens, and in-page Settings search.
- Google import: native multi-step flow with grouped mobile cards instead of
  desktop tables.
- Onboarding: native paged flow with no icon or illustration placeholder in
  v1; the illustration area remains empty until supplied assets exist.

## Data and offline behavior

- Online-first behavior.
- Persist recent read-only query data and show an offline banner when network
  access is unavailable.
- Never sign out solely because the network is unavailable.
- Mutations remain online-only in v1; safe GET requests may retry with
  backoff, while mutations are not blindly retried.
- Pull-to-refresh is enabled on Dashboard, Tasks, Calendar, Availability, and
  Progress.
- Account Timezone remains authoritative even when it differs from the device
  timezone.

## Motion and accessibility

- Use native navigation transitions, Reanimated sheets, Calendar gestures,
  press feedback, progress transitions, and haptic feedback where useful.
- Target smooth 60fps interactions and keep animation work off the JS thread
  where possible.
- Respect reduced-motion preferences.
- Accessibility is quality guidance, not a manual release gate. Fix obvious
  functional problems such as clipped controls, missing primary labels, and
  color-only status meaning.

## Implementation phases

### Phase 0 — workspace and contracts

- Add root pnpm workspace configuration.
- Add `packages/api`, `packages/domain`, and `packages/design-tokens`.
- Extract shared pure types/utilities without changing web behavior.
- Add mobile API transport interfaces and query-key conventions.

### Phase 1 — native shell and authentication

- Create Expo app in `mobile/` with Expo Router.
- Add theme, tokens, splash, root tabs, native stack, account sheet, and error
  boundary.
- Implement secure token storage and centralized refresh client.
- Add email/password and Google OAuth deep-link flows.
- Add verification and password-reset deep links, including mobile links in
  authentication emails.

### Phase 2 — first vertical slice

- Implement Dashboard and Tasks using shared API/domain packages.
- Add TanStack Query cache, pull-to-refresh, loading, empty, error, and
  offline states.
- Implement task search popup, filters, forms, adaptive estimate behavior,
  row actions, swipe-to-delete, and native confirmations.

### Phase 3 — planning workflows

- Implement one-day Calendar timeline and date navigation.
- Implement session sheet and shared Session Outcome form.
- Implement Schedule Revision review and acceptance/rejection.
- Preserve all web entry points for Session Outcomes.

### Phase 4 — availability, progress, and settings

- Implement day-based Availability timeline and full-screen editors.
- Implement Progress summary grid and detail rows.
- Implement Settings list, profile, security, preferences, appearance,
  Google linking, and account deletion.

### Phase 5 — Google import and deep links

- Implement Calendar/Classroom OAuth return flow.
- Implement grouped import preview, selection, confirmation, and result
  states.
- Add task, revision, import, verification, and reset-password app links.

### Phase 6 — polish and verification

- Replace temporary illustration gaps only when approved assets are supplied.
- Tune motion, haptics, sheets, gestures, skeletons, and platform-specific
  behavior.
- Manually review core flows on representative iOS and Android devices as
  recommended quality work, not a release-blocking requirement.
- Add CI-only checks for mobile type safety, linting, and Expo config.

## Current implementation state

- [x] Decision record created.
- [x] Local branch created: `feature/mobile-app`.
- [x] Root workspace and shared packages.
- [x] Expo mobile shell.
- [x] CI-only typecheck and lint checks.
- [x] Mobile email authentication backend/client and secure token transport.
- [x] Product screens first pass and core API workflows.
- [x] CI validation for mobile type safety, linting, and Expo config.

The current implementation includes the first working vertical shell: auth gate,
SecureStore token persistence and refresh, TanStack Query persistence, the five
root tabs, native account/search/filter sheets, task CRUD/actions, date-aware
calendar with native date picking, session outcomes, schedule revisions,
editable availability and blocked periods, progress rows, settings subpages,
mobile account deletion, native Google Sign-In, Google Calendar/Classroom
preview/selection/import, first-launch onboarding, verification/reset app links,
offline banner, reduced-motion-aware transitions, and swipe-to-delete with native
confirmation. Remaining work is haptic polish and device-level review. No beta,
CD, store submission, OTA, or builds are included in this version.
