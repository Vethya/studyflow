# StudyFlow Storybook

Run commands from `frontend` with the project's `pn` alias:

```sh
pn storybook
pn build-storybook
pn test:storybook
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
