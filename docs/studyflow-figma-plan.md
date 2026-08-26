# StudyFlow — Figma UI Implementation Plan

A production-grade UI blueprint for building StudyFlow in Figma, modeled on the
**Shadcnblocks Admin Kit (Next.js + shadcn/ui)** reference. The goal is a UI that
reads like a real, shipped product from a serious company — restrained, consistent,
information-dense where it matters, and free of "AI-generated" tells.

- **File:** `https://www.figma.com/design/JlUYWxdoGh3NazdgatfxX3/StudyFlow`
- **Frame convention:** one desktop screen per top-level frame, `1440 × 1024`, laid
  out left→right with a 160px gap between screens.
- **Design language:** shadcn/ui, "zinc" neutral light theme.

---

## 0. Current file state (resume point)

- `Frame 1` — original user frame (leave untouched).
- `Screen / Dashboard` (`32:2`) — shadcn app shell already built:
  - Light sidebar (`256px`) with brand mark, "MENU" label, 6 lucide nav items, user footer.
  - Top bar (needs rework — see §3.2) and an empty `Content` frame.

**First action on resume:** rework the top bar and sidebar grouping to match the
reference, then build content, then clone the shell for the other screens.

---

## 1. Design principles (how we avoid the "AI look")

1. **One accent, used sparingly.** Primary is near-black `zinc-900`. Color appears only
   for status (success/warning/danger/info) and small data-viz accents — never decorative
   gradients or rainbow cards.
2. **A real spacing scale.** 4 / 8 / 12 / 16 / 20 / 24 / 32. No arbitrary values.
3. **Consistent radii.** `8px` for cards/inputs/buttons, `6px` for small controls,
   `999px` for pills/avatars. Never mix.
4. **Hairline borders over shadows.** `1px #E4E4E7` borders define structure; shadows are
   near-invisible (`y1, blur2, 5% black`). Cards are white on a `#FAFAFA` canvas.
5. **Type hierarchy is strict.** Numbers are big and bold; labels are small, muted, and
   often UPPERCASE with tracking. Body is 13–14px. No more than 4 sizes per screen.
6. **Real content, real alignment.** Use plausible StudyFlow data (course codes, minute
   counts, dates). Right-align numbers in tables. Baseline-align labels to values.
7. **Every screen shares the exact same chrome.** Sidebar + top bar are pixel-identical;
   only the active nav item, page title, and content change.
8. **Include the unglamorous states.** Empty rows, "awaiting" states, filters, dropdown
   affordances, `•••` row menus, pagination — these sell realism.

---

## 2. Design tokens

### 2.1 Color (shadcn zinc, light)
| Token | Hex | Use |
|---|---|---|
| `background` | `#FFFFFF` | app base, cards |
| `canvas` (muted/40) | `#FAFAFA` | content & sidebar background |
| `foreground` | `#09090B` | primary text, headings |
| `muted-foreground` | `#71717A` | secondary text, labels |
| `subtle-foreground` | `#A1A1AA` | icons idle, placeholders |
| `border` | `#E4E4E7` | all hairlines, inputs |
| `border-strong` | `#D4D4D8` | hover borders |
| `primary` | `#18181B` | primary buttons, active icon/text |
| `primary-foreground` | `#FAFAFA` | text on primary |
| `accent` (hover/active bg) | `#F4F4F5` | nav active, ghost hover, toggles |
| `secondary` | `#F4F4F5` | secondary button bg |

### 2.2 Status color (foreground / subtle-bg)
| Status | FG | BG |
|---|---|---|
| Success (Completed) | `#166534` | `#DCFCE7` |
| Warning (Delayed / Unscheduled) | `#B45309` | `#FEF3C7` |
| Danger (Overload / High / Overdue) | `#B91C1C` | `#FEE2E2` |
| Info (Awaiting / In Progress) | `#1D4ED8` | `#DBEAFE` |
| Neutral (Low / Not Started) | `#52525B` | `#F4F4F5` |

### 2.3 Data-viz palette (muted, 2–3 max per chart)
- Line/primary series: `#18181B` (near-black line) with soft area `#E4E4E7`.
- Category accents: `#6366F1` (indigo), `#14B8A6` (teal), `#F43F5E` (rose),
  `#F59E0B` (amber), `#0EA5E9` (sky), `#71717A` (zinc). Use flat fills, no gradients.

### 2.4 Typography — Inter
| Style | Size / Weight / Tracking | Use |
|---|---|---|
| Page title | 22 / Bold / -1% | content header H1 |
| Section title | 15 / Semi Bold | card headers |
| Metric | 28–30 / Bold / -1% | stat card numbers |
| Body | 13.5 / Regular | default text |
| Body-strong | 13.5 / Medium–Semi Bold | table cells, nav |
| Label (overline) | 11 / Semi Bold / +6% UPPERCASE | stat labels, sidebar sections |
| Caption | 11.5 / Regular | meta, timestamps, deltas |

Verified Inter styles: `Regular`, `Medium`, `Semi Bold`, `Bold` (note the space in
"Semi Bold").

### 2.5 Radius / spacing / elevation
- Radius: card/button/input `8`, chip/toggle `6`, pill/avatar `999`.
- Card padding: `20` (compact `16`). Content padding: `28`. Item gaps: `20` between cards.
- Shadow (card): `DROP_SHADOW y:1 blur:2 spread:0 rgba(9,9,11,0.05)`.

### 2.6 Icons — lucide (stroke 2, round caps), rendered via `createNodeFromSvg`
Sidebar: `layout-dashboard`, `calendar`, `list-todo`, `clock`, `trending-up`, `settings`.
Chrome: `panel-left` (collapse), `search`, `bell`, `chevron-down`, `chevron-right`,
`plus`, `sliders-horizontal` (settings gear), `ellipsis` (`•••`).
Content: `alert-triangle` (overload), `calendar-clock` (unscheduled), `history`
(awaiting), `arrow-up-right`/`arrow-down-right` (deltas), `graduation-cap` (brand).

---

## 3. Layout system (matches the reference)

### 3.1 Sidebar (`256px`, `#FAFAFA`, right border)
Grouped, with muted uppercase section headers (like General / Pages / Other):
- **Brand row** — dark rounded square + `graduation-cap`, "StudyFlow" / "Study planner",
  trailing `chevron-down` (collapse affordance).
- **PLANNING** — Dashboard · Calendar · Tasks
- **REVIEW** — Availability · Progress
- **ACCOUNT** — Settings (expandable → Profile, Security, Preferences, Timezone shown as
  indented sub-items with a left guide line on the active page)
- **Footer** — user card (avatar `MH`, "Meng Heang", "rosmeng@kit.edu", `chevron-down`),
  boxed with border, pinned to bottom via a flex spacer.

Nav item: `36px` tall, `10px` radius `8`, icon 18px + label 13.5.
Active = bg `#F4F4F5`, icon+label `#18181B` Semi Bold. Idle = icon `#71717A`, label
`#52525B` Medium.

### 3.2 Top bar (SLIM — rework to match reference)
Height ≈ `52px`, white, bottom border. **No page title here.**
- **Left:** `panel-left` collapse icon button + a search field
  (`Search…` + a `⌘K` kbd chip on the right, border, `bg #FFFFFF`, width ~320).
- **Right:** `bell` icon button + `sliders-horizontal` (settings) icon button +
  vertical divider + compact avatar. All 36px ghost/outline icon buttons.

### 3.3 Content header (inside content, per screen)
Row: **Page title (22 Bold)** on the left; **action buttons** on the right.
Below it, a **tab bar** (shadcn underline/segment tabs).
- Dashboard actions: `Regenerate schedule` (outline + `refresh-cw`) · `Add task` (primary + `plus`).
- Tabs: `Overview` (active) · `Next 14 Days` · `Unscheduled`.

### 3.4 Content grid
12-col mental model. Common rows:
- 3 equal stat cards + 1 wide chart card (like New Subs/Orders/Revenue + Total Revenue).
- 1 wide chart + 1 narrow chart (Sale Activity + Subscriptions).
- 1 wide table + 1 narrow list (Payments + Team Members).

---

## 4. Component specs

### 4.1 Buttons
- **Primary:** bg `#18181B`, text `#FAFAFA`, radius 8, padding `9×14`, icon 16 + label 13 Semi Bold.
- **Outline:** bg `#FFFFFF`, border `#E4E4E7`, text `#18181B`; hover border `#D4D4D8`.
- **Ghost:** transparent, hover bg `#F4F4F5`.
- **Icon button:** `36×36`, outline or ghost, icon 17 `#3F3F46`.

### 4.2 Input / search
White, border `#E4E4E7`, radius 8, `8×10` padding, `search` icon leading, placeholder
`#A1A1AA`. Optional trailing `⌘K` kbd: bg `#F4F4F5`, border, radius 4, 10px `#71717A`.

### 4.3 Card
White, border `#E4E4E7`, radius 8, card shadow, padding 20. Header = title (15 Semi Bold)
+ optional trailing control (info icon / `•••` / link). Optional description (12.5 muted).

### 4.4 Stat card (reference "New Subscriptions")
Row1: small icon + label (overline) … trailing `info` icon.
Row2: metric (28 Bold). Row3: caption "Since last week". Footer row: `Details` link +
delta pill (`▲ 15.5%` success / `▼ 4.2%` danger) + a 64×24 **sparkline** (SVG polyline).

### 4.5 Badge / pill
Radius 6 (status) or 999 (count). Padding `3×8`, 11 Semi Bold. Uses status FG/BG pairs.
Non-color cue required (icon or text) for accessibility.

### 4.6 Data table (reference "Payments")
Header row: checkbox + column labels (11 Semi Bold muted, `Amount` right-aligned) +
sortable `⇅` on one column. Body rows `52px`, bottom hairline, checkbox + cells +
trailing `•••`. Toolbar above: filter input + `Columns ▾` outline button. Footer:
row count + pagination `‹ 1 2 … ›`.

### 4.7 List card (reference "Team Members")
Header (title + description) then rows: avatar/icon tile + two-line text (FILL) +
trailing control (role dropdown pill / action link). 12–14 gap, hairline dividers.

### 4.8 Tabs
Segment style: track `#F4F4F5` radius 8 pad 3; active tab white with tiny shadow.
OR underline style: labels 13 Medium, active `#18181B` with 2px bottom bar. Pick ONE
and use everywhere (default: underline, matching the reference's "Overview / Analytics").

### 4.9 Charts (drawn as vectors)
- **Sparkline / line:** `createNodeFromSvg` polyline, stroke `#18181B` 2px, no fill.
- **Area:** SVG `path` fill `#F4F4F5` (or 10% accent) + top stroke line.
- **Bars:** rects, radius 3, alternating category colors, baseline aligned, subtle
  gridline behind. X-axis month/day labels 10px muted.

### 4.10 Sidebar section header
11px Semi Bold `#A1A1AA`, +6% tracking, UPPERCASE, padding `8/8`, `16px` top gap.

---

## 5. Screen specifications

> All screens share §3.1 sidebar + §3.2 top bar. Only header title, tabs, and content differ.

### 5.1 Dashboard — "What needs attention now"
- **Header:** title `Dashboard`; actions `Regenerate schedule` (outline), `Add task` (primary).
- **Tabs:** Overview · Next 14 Days · Unscheduled.
- **Row 1 (3 stat + 1 wide):**
  - `Next Session` (clock): metric `in 2h 15m`; caption `Calculus — P-Set 3 · 3:30 PM`; footer `View` + `60 min` pill.
  - `Today's Workload` (list-todo): metric `2h 40m`; caption `across 3 sessions`; footer `2 upcoming` · `1 done`.
  - `Weekly Effort` (trending-up): metric `62%`; caption `8h 15m / 13h 20m`; progress bar.
  - `Study Time — Last 7 Days` (wide): big `9h 40m` + line chart (min/day Mon–Sun).
- **Row 2:** `Study Activity — This Month` area chart (wide) + `Sessions by Category` bar chart
  (Assignment/Reading/Exam/Project/Research counts).
- **Row 3:** `Upcoming Deadlines` **table** (Task · Category · Due · Priority · `•••`) +
  `Needs Attention` **list** (Overload / Unscheduled Work / Awaiting Outcome rows with
  icon tile, explanation, and action link).

### 5.2 Calendar — operational planning workspace
- **Header:** title `Calendar`; actions `‹ Today ›` week nav + date, segment toggle
  `Week / Agenda`, `Add task` (primary).
- **Body:** full-width week grid card — time gutter (8AM–8PM) + 7 day columns with header
  (day + date, today highlighted), hairline hour lines, weekend columns tinted, session
  blocks (color by category, left accent, title + time), unavailable regions shaded.
- **Below grid (2-col):** `Next 14 Days` agenda list (date group → session rows) +
  `Unscheduled & Overdue` panel (work with explanations + `Reschedule`).

### 5.3 Tasks — management & bulk browsing
- **Header:** title `Tasks`; actions `Add task` (primary). 
- **Tabs:** All · In Progress · Not Started · Completed · Overdue (counts in pills).
- **Toolbar:** search + filter chips (`Course ▾`, `Category ▾`, `Priority ▾`, `Status ▾`) + `Columns ▾`.
- **Table:** checkbox · Title (+course sub) · Category badge · Priority badge · Deadline ·
  Planned/Actual (e.g. `120 / 95 min`) · Effort progress mini-bar · Status badge · `•••`.
- **Footer:** count + pagination.

### 5.4 Availability — recurring windows & exceptions
- **Header:** title `Availability`; actions `Add window` (outline), `Add unavailable` (primary).
- **Left (wide):** `Weekly Availability` mini week grid showing green window blocks (Mon–Sun),
  editable chips per day (`6:00 PM – 10:00 PM`).
- **Right:** `Unavailable Periods` list (dated exceptions with delete) + an info callout:
  "Changing availability may invalidate future sessions — regenerate schedule to fix."
  with a `Regenerate` button.

### 5.5 Progress — effort tracking (no accuracy analytics)
- **Header:** title `Progress`; tabs `By Task · By Week`.
- **Row 1 stat cards:** `Total Studied` (mins), `Sessions Completed`, `Avg Session`, `On-track tasks`.
- **Row 2:** `Effort Over Time` area chart (wide) + `Time by Category` donut/bar.
- **Row 3:** `Task Effort` table — Task · Status · Effort progress bar+% · Actual min ·
  Est. remaining · Sessions (done/upcoming). Explicit caption: "Effort Progress reflects
  time invested, not grade or content completion."

### 5.6 Settings — account & preferences
- **Header:** title `Settings`; secondary sidebar tabs (Profile / Security / Preferences / Timezone).
- **Profile:** Name, email (read-only + `Verified` badge), linked Google identity row (`Connected`).
- **Security:** Change password form (12+ char rule note), active session note (24h/7d),
  `Sign out`.
- **Preferences:** Preferred Session Length (slider/stepper 10–240, default 60),
  Minimum Session Length (default 20), Minimum Break (0–120, default 10).
- **Timezone:** current tz select + note about preserving deadline instants.
- Each group is a Card with a title, description, form fields, and a right-aligned `Save`.

### 5.7 Auth (bonus, optional) — Login / Register
Centered card on `#FAFAFA`: brand, title, email + password fields, primary button,
`Continue with Google` outline (google glyph), secondary link. Register adds confirm +
12-char helper. Matches token system exactly.

---

## 6. Figma build sequence (resumable steps)

Each step = one `use_figma` call; validate with `get_metadata` / screenshot after milestones.
Reuse the `hex/solid/txt/icon(inner,size,color)` helpers in every call.

1. **Rework top bar** on `32:2`: remove title/subtitle+New Task from bar; add `panel-left`
   + search(⌘K) on left, `bell` + `settings` + divider + avatar on right; height ~52.
2. **Regroup sidebar**: insert section headers (PLANNING / REVIEW / ACCOUNT), keep icon
   nav; add indented Settings sub-items (hidden by default or shown on Settings screen).
3. **Dashboard content header**: title + `Regenerate schedule`/`Add task` + underline tabs.
4. **Dashboard Row 1**: 3 stat cards (with sparklines) + wide line-chart card.
5. **Dashboard Row 2**: area chart card + bar chart card.
6. **Dashboard Row 3**: deadlines table + needs-attention list. Screenshot & polish.
7. **Clone shell → 5 screens** (Calendar, Tasks, Availability, Progress, Settings): set
   active nav, recolor active icon (traverse vectors), set page title, clear content.
8. **Calendar** content (grid + agenda + unscheduled).
9. **Tasks** content (tabs + toolbar + table + pagination).
10. **Availability** content (week grid + unavailable list + callout).
11. **Progress** content (stat cards + charts + effort table).
12. **Settings** content (sub-tabs + form cards).
13. *(optional)* **Auth** screens.
14. **Final pass**: screenshot every screen, fix clipped text / misalignment / uneven
    card heights (set equal-height rows via `counterAxisSizingMode=FIXED` + child `FILL`).

### Known Figma gotchas to respect (from earlier build)
- `counterAxisAlignItems` enum is `MIN|MAX|CENTER|BASELINE` (no `END`).
- No `padding` shorthand — set `paddingTop/Right/Bottom/Left`.
- `resize()` resets sizing to `FIXED` → re-apply `layoutSizingHorizontal='FILL'` AFTER resize.
- Recolor lucide icons by traversing descendant vectors and reassigning `strokes`.
- Load Inter (`Regular/Medium/Semi Bold/Bold`) at the top of every text-writing call.
- Return created node IDs from every call.

---

## 7. Definition of done
- All 6 core screens share identical sidebar + slim top bar; only active state/title/content change.
- Zero clipped text, zero overlaps, equal-height card rows, aligned numeric columns.
- Only status + small data-viz colors break the neutral palette; no gradients.
- Realistic StudyFlow data throughout; empty/awaiting/overload states represented.
- Reads like the Shadcnblocks Admin Kit reference — professional, consistent, intentional.

---

## 8. Illustration, mascot & avatar system (student personality)

Goal: make StudyFlow feel warm and motivating for students **without** breaking the
shadcn/professional frame. Personality shows up in small, deliberate places — never in
the core data UI (tables, forms, charts stay clean and neutral).

### 8.1 Assets shipped (in `assets/`)
- **Mascot — "Flo"** (`brand/mascot-owl.svg`): scholar owl in StudyFlow indigo. A friendly,
  geometric flat character. Uses: onboarding, login/register hero, empty states, streak
  and goal-complete celebrations, error pages.
- **Student avatars — REJECTED DRAFTS:** do not import the hand-built SVG set. Replace it
  with an image-generated, art-directed set approved from a contact sheet. The production
  brief is in `assets/image-generation-prompts.md`.
- **Flo mascot — REQUIRES REDESIGN:** replace the single draft with one invariant mascot
  design and a consistent emotion/action set for product states (happy, focused, concerned,
  urgent, sad, encouraging, celebrating, resting, and empty-state). See the same brief.
- **Achievement badges** (`brand/badge-streak|focus|level|medal.svg`): light gamification
  medallions in status colors. Uses: Progress page, dashboard "streak" chip, session
  completion toasts.
- **Preview:** open `assets/gallery.html` in a browser to see the full set.

### 8.2 Style rules (so it reads pro, not "AI clip-art")
- Flat only — no gradients, no drop shadows on the illustrations, no 3D.
- Palette locked to the design tokens (§2.1–2.3); backgrounds use the soft status tints.
- Consistent geometry: 96×96 avatars (circle crop), 64×64 badges, 128×128 mascot.
- 2px round-cap strokes to match lucide; shapes stay simple and legible at 24–32px.
- One personality element per surface max (e.g. mascot in empty state OR a badge, not both).

### 8.3 Where personality appears (and where it must NOT)
| Surface | Personality element |
|---|---|
| Login / Register | Flo mascot hero beside the form |
| Onboarding / first-run | Flo + short copy, avatar picker |
| Dashboard | small streak badge chip in header ("🔥 5-day streak" → badge-streak icon + text); optional Flo in "all clear" empty state |
| Sidebar user card + Settings/Profile | selected student avatar |
| Progress | achievement badges row (streak / focus / level / goal) |
| Empty states (no tasks, no sessions, inbox zero) | Flo + one-line encouragement + primary CTA |
| Celebration toasts | badge-medal / badge-level on task complete or goal hit |
| **Tables, forms, charts, calendar grid** | **none — stay neutral & professional** |

### 8.4 Avatar picker component (Settings › Profile)
Card "Avatar": current avatar (64px) + "Choose avatar" → a grid of the 8 avatars as
selectable circles (2px `#18181B` ring on selected), plus an "Upload photo" outline button.
Consistent with shadcn radio-group semantics.

### 8.5 Figma build additions (append to §6 sequence)
- **Import SVGs:** use `figma.createNodeFromSvg(<svg string>)` for mascot/badges, or the
  `upload_assets` MCP tool for any raster versions; keep each as a named component
  (`Mascot/Flo`, `Avatar/01…08`, `Badge/Streak…`) so instances stay consistent.
- Replace the sidebar user-card monogram (`MH`) with `Avatar/01`.
- Add a **streak chip** to the Dashboard header: badge-streak (18px) + "5-day streak" (12 Medium).
- Add a **Progress "Achievements"** card: 4 badges in a row with labels + earned dates.
- Build one **empty-state block** component (Flo 96px + title + muted line + primary CTA)
  and reuse on Tasks/Calendar/Progress when lists are empty.
- **Login screen** (§5.7): Flo hero (160px) on a `#FAFAFA` left panel, form card on the right.

### 8.6 Definition of done (personality)
- Mascot + chosen avatar visible on chrome and auth; badges on Progress.
- Zero illustration inside data tables/forms/charts.
- Everything uses the token palette; nothing looks stocky or off-brand.
- Friendly but restrained — a serious study tool that students actually enjoy opening.
