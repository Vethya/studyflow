# StudyFlow — Screens builder (Figma plugin)

Builds page **`03 Screens`** of the StudyFlow Figma file from the shipped app.

Runs as a local development plugin in the Figma **desktop** app. It works on a
free account and does **not** use the Figma MCP, so it is not affected by the
MCP tool-call quota.

## What it builds

Eight screens, laid out left to right on `03 Screens`:

| Screen | Contents |
| --- | --- |
| Dashboard | Up next, capacity verdict, four figures, weekly effort, deadlines, shortfall cards, unscheduled work |
| Tasks | Toolbar with search/sort/filters, 9-row ledger |
| Calendar | Four figures, week grid with sessions on availability, 14-day agenda |
| Availability | Three figures, week grid, per-day windows list, exceptions |
| Progress | Effort callout, five totals, per-task effort table, session history |
| Settings | Profile, Signing in, Timezone, Study sessions, Sign out |
| Sign in | Centred card on the landing page's sky gradient |
| Overlays | Record outcome, Confirm delete, Large adjustment, Schedule preview |

## Screens are full height, not a fixed viewport

Each frame is **1440 wide and hugs its content vertically**. A page that
scrolls in the browser is therefore shown in full rather than cut off at
1080 — the Dashboard and Progress frames in particular run well past a
screen height. The sidebar stretches to match via `layoutSizingVertical`,
so the shell still reads as one continuous screen.

The two exceptions are deliberate: **Sign in** is a fixed 1440 × 900 because
it is a centred layout that does not scroll, and **Overlays** hugs its row of
dialogs.

## Prerequisites

Pages `01 Foundations` and `02 Components` must already exist, because this
script **reuses** their colour variables and text styles rather than creating
its own. If the variables are missing it stops with a message instead of
building something unstyled.

## Running it

1. Open the StudyFlow file in the Figma **desktop** app.
2. Menu → **Plugins → Development → Import plugin from manifest…**
3. Choose `docs/figma-plugin/manifest.json`.
4. Menu → **Plugins → Development → StudyFlow — Screens builder**.

## What it deletes

Only top-level frames on `03 Screens` whose name starts with `Screen / ` —
its own output, so re-running after an app change is safe and idempotent.
Other pages, other frames, the variables and the text styles are untouched.

## Notes for editing this script

- `figma.createAutoLayout()`, `node.set()` and `node.query()` are conveniences
  the MCP's `use_figma` sandbox adds. They **do not exist** in the real Plugin
  API — this file uses `createFrame()` + `layoutMode` throughout.
- `resize()` resets **both** sizing axes to `FIXED`, so any `HUG`/`FILL` must
  be set *after* it. This is the single most common source of frames that
  refuse to grow.
- Auto-layout frames are created with an opaque **white fill** by default.
  Structural frames here pass no `bg`, which clears it.
- Colours come from the app's own tokens in `frontend/app/globals.css`,
  converted from `oklch` to sRGB. Change the CSS and re-derive rather than
  hand-editing hex values here, or the file stops being a record of the build.
