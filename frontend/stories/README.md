# StudyFlow Storybook

Run commands from `frontend` with the project's `pn` alias:

```sh
pn storybook
pn build-storybook
pn test:storybook
pn check:stories
```

Storybook runs at http://localhost:6006. The static export is `storybook-static`.
The automated interaction suite uses Playwright Chromium. Install it with
`pn exec playwright install chromium` if it is missing.

Stories import the real components. Use Controls to explore props, the toolbar
to select light, dark, or AMOLED, and the viewport tools to check narrow layouts.
Control changes are temporary. Edit the component, app CSS, or story source to
save changes; Storybook updates automatically.

Docs examples render in separate iframes to isolate their API scenarios.
Each Docs page runs one primary example to prevent concurrent interaction playback.
Use the Canvas tab for every variant and interactive Controls.

Add typed `.stories.tsx` files under `stories`, grouped by UI, feature, or page.
Each interactive control should have an accessible label. Use `fn()` for callback
args and `play` assertions for behavior. Keep app components and their stories
in sync when adding variants or changing props.

Storybook reports accessibility violations with axe in the panel and test output.
They are advisory while the existing components have contrast violations, such
as the destructive button variant. Interaction failures still fail the suite.
Keyboard and screen reader review require human judgment.

The catalog includes every file under `components` and every route page. Providers
are exercised through the shared wrapper. The `/app` callback has a redirect
assertion because it has no rendered screen. `check:stories` fails when a new
component/page file has no Storybook import; it does not measure branch coverage.

Feature and page stories use `parameters.app: true` to install the real session,
timezone, and SWR providers. Every story gets a fresh cache and mock store. Dates
use 16 October 2026 in Asia/Phnom_Penh. `parameters.api` selects `ready`, `empty`,
`loading`, or `error` via `state`; it also controls authentication, pending plans,
adaptive history, overload, and Google configuration. The worker is served only
by Storybook. Unknown API requests fail with 501 and fail the story suite.

These mocks demonstrate UI behavior. They do not run the scheduling algorithm,
send email, delete real accounts, or complete Google OAuth. OAuth actions show a
demo error; import review uses synthetic data. Backend integration keeps its
existing test suite. Storybook CI checks catalog coverage, compilation, and
Playwright-backed interactions and retains the static preview for seven days.
