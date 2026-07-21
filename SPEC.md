# StudyFlow Software Specification

## 1. Document Status and Authority

This specification consolidates the StudyFlow proposal, presentation, and the product-design decisions resolved during the requirements grilling session.

The approved revised requirements are authoritative when they differ from the original proposal or presentation:

- FR-01 through FR-09 and NFR-01 through NFR-06 in this specification define the binding requirements baseline.
- FR-10 from the original proposal is superseded. Effort Progress remains under FR-06, while estimation-accuracy analytics remain internal to adaptive qualification and thesis evaluation.
- `B11-P10_StudyFlow_Presentation.pdf` is an explanatory summary.
- The proposal remains a historical source artifact; the scope decisions recorded here supersede its earlier requirement wording.
- This specification resolves ambiguities left open by the proposal and presentation.

Source artifacts:

- `/Users/macbookpro/Documents/School/Kirirum Institute of Technology (KIT)/Year 4/Final Thesis/0th Review/B11-P10_StudyFlow_Proposal.pdf`
- `/Users/macbookpro/Documents/School/Kirirum Institute of Technology (KIT)/Year 4/Final Thesis/0th Review/B11-P10_StudyFlow_Presentation.pdf`

The product is a responsive web application for university students. Its core contribution is a behavior-adaptive scheduler that converts academic tasks into feasible study sessions, learns from estimated-versus-actual duration records, detects overload, and proposes controlled schedule revisions.

## 2. Product Goals

StudyFlow must:

1. Securely manage student accounts and student-owned planning data.
2. Convert academic tasks into manageable study sessions.
3. Generate schedules that respect deadlines, availability, breaks, and session preferences.
4. Preserve student control over generated and revised schedules.
5. Record actual study behavior with low-friction manual entry and show Effort Progress.
6. Produce adaptive duration estimates only when personal evidence demonstrates that they are meaningfully more accurate.
7. Detect overload quantitatively and never disguise infeasible work as a valid schedule.

### 2.1 Binding Functional Requirements

- **FR-01 — Account:** The system shall allow a student to register and authenticate using email and password, sign out, and manage essential account settings, including name, password, timezone, and study-session preferences. Google Sign-In, email verification, password recovery, and confirmed account linking remain supported authentication details.
- **FR-02 — Academic Tasks:** The system shall allow a student to create, view, update, and delete Academic Tasks containing a Category, Deadline, Priority, and Original Estimate, subject to the defined task-lifecycle rules.
- **FR-03 — Availability:** The system shall allow a student to manage recurring weekly Availability Windows and dated Unavailable Periods.
- **FR-04 — Task Splitting:** The system shall divide Academic Tasks into manageable Study Sessions according to their Planned Duration and the student's Preferred Session Length.
- **FR-05 — Scheduling:** The system shall generate conflict-free schedules using availability, Deadlines, urgency, Priority, remaining workload, and minimum breaks, and allow the student to accept, reject, or regenerate a proposed schedule.
- **FR-06 — Outcomes and Progress:** The system shall allow a student to record Study Sessions as Completed, Delayed, or Missed, manually record Actual Duration, and update Effort Progress using recorded work and estimated remaining duration.
- **FR-07 — Adaptive Estimation:** The system shall use one transparent personal correction method to generate Adaptive Estimates from the student's earlier estimated-versus-actual completion records. It shall use an Adaptive Estimate only after sufficient evidence shows that it is meaningfully more accurate; otherwise, it shall continue using the Original Estimate.
- **FR-08 — Overload:** The system shall detect when remaining workload cannot fit within valid study time before its Deadline and display the affected work, capacity shortfall, relevant constraints, and possible remedies.
- **FR-09 — Unfinished-Work Revision:** After a Study Session is recorded as Delayed or Missed, the system shall automatically generate a proposed Schedule Revision for the unfinished work and require the student to accept it before it replaces the active schedule.

FR-10 is removed. Internal estimate-comparison metrics remain required for adaptive-estimation qualification and thesis evaluation but are not presented to students as estimation-error statistics or model-accuracy analytics.

## 3. Product Scope

### 3.1 Included

- Responsive React web application.
- Student registration, email verification, login, logout, password recovery, and account settings.
- Email/password authentication and Google Sign-In.
- Academic Task CRUD.
- Optional Course and Notes fields.
- Recurring weekly availability and dated unavailable periods.
- Session splitting using the student's Preferred Session Length.
- Configurable breaks between sessions.
- OR-Tools CP-SAT schedule generation.
- Completed, Delayed, and Missed outcomes.
- Awaiting Outcome handling.
- Automatic but student-approved Schedule Revisions after Delayed or Missed sessions.
- Overload and Unscheduled Work explanations.
- Behavior-adaptive estimation with one transparent personal correction method.
- Effort Progress without student-facing estimation-accuracy analytics.
- Responsive desktop and mobile-width workflows.

### 3.2 Explicitly Excluded

- Adviser, supervisor, administrator, or university-management application roles.
- Account deletion.
- Active-device management and sign-out-all-devices controls.
- Study Timer functionality.
- Manual session movement, drag-and-drop, and pinning.
- Browsable immutable schedule history.
- Ridge Regression or competing adaptive-estimation methods.
- Student-facing estimation-error statistics or model-accuracy analytics.
- Native Android or iOS applications.
- Offline mode or installable PWA requirements.
- LMS integration.
- Google Calendar integration.
- Adviser/admin dashboards.
- Automatic grading or grade prediction.
- Academic-performance prediction.
- Generative-AI agents.
- Paid LLM dependencies.
- Public third-party API access.
- Session reminder emails, push notifications, or notification infrastructure.
- In-product research surveys or feedback collection.
- Production-scale availability guarantees.

### 3.3 Nice to Have, Not Release Blocking

- WCAG 2.2 Level AA conformance.
- Automated daily backups.

Basic accessibility quality remains expected even though formal WCAG conformance is optional: keyboard access, semantic labels, visible focus, adequate contrast, and non-color status indicators.

## 4. Users and Ownership

### 4.1 User Type

The university student is the only direct application user type.

### 4.2 Ownership

Every task, availability record, unavailable period, session, active schedule, proposed revision, behavior record, and progress record belongs to exactly one Student Account.

All ownership checks must be enforced server-side. Querying another student's resource identifier returns `404 Not Found`, preventing disclosure that the resource exists. Unauthenticated requests return `401 Unauthorized`.

## 5. Canonical Domain Language

The following definitions are normative for the revised requirements baseline. `CONTEXT.md` must be aligned separately before it is treated as the canonical glossary for implementation.

### 5.1 Accounts and Time

**Student Account**  
The student's identity and planning preferences. It includes name, linked authentication identities, Account Timezone, Preferred Session Length, and Minimum Break.

**Account Timezone**  
The student-selected timezone used to interpret deadlines, availability, and sessions. It is initially detected from the browser and remains editable.

**Deadline**  
The exact local date and time by which all work for a task must be completed. No session may cross or end after it.

### 5.2 Tasks and Estimates

**Academic Task**  
A student-owned piece of academic work with title, Deadline, Priority, Category, and expected total duration. Course and Notes are optional organizational fields.

**Priority**  
Student-assigned academic importance: Low, Medium, or High. It defaults to Medium and is distinct from urgency.

**Urgency**  
Time pressure calculated from deadline and remaining workload. Urgency outranks Priority when overloaded work competes for capacity.

**Original Estimate**  
The student's initial prediction of total task duration. It may be edited until the first session begins, then becomes frozen.

**Adaptive Estimate**  
StudyFlow's personal prediction based only on earlier completed records. It is unavailable until its method passes the agreed performance gate.

**Planned Duration**  
Either the Original Estimate or an available Adaptive Estimate selected for scheduling. It cannot be an unrelated third value.

**Actual Duration**  
The sum of minutes actually worked across all task sessions, including Delayed attempts. Missed sessions contribute zero.

**Effort Progress**  
`Actual Duration / (Actual Duration + estimated remaining duration)`. It measures expected effort consumed, not content completion, quality, or grade.

### 5.3 Sessions and Outcomes

**Study Session**  
A scheduled block representing all or part of an Academic Task. Every task becomes one or more sessions.

**Session Outcome**  
Completed, Delayed, or Missed.

**Completed**  
The session's planned work was finished. Actual minutes must be greater than zero and no work for that session remains.

**Delayed**  
Some work occurred but the session's planned work was not finished. Actual minutes and revised remaining minutes must both be greater than zero.

**Missed**  
No work occurred. Actual minutes equal zero and all planned work remains.

**Awaiting Outcome**  
A past session with no student-confirmed outcome. Its work remains outstanding but contributes no behavior data.

### 5.4 Scheduling State

**Schedule Revision**  
A proposed replacement for future sessions generated after a Delayed or Missed outcome. It becomes active only after complete acceptance.

**Unscheduled Work**  
Remaining work with no valid session. It stays visible until constraints change or a valid revision is accepted.

**Overload**  
Required remaining work cannot fit within available time before its Deadline.

**Task Status**  
Automatically derived as Not Started, In Progress, Completed, or Overdue. At Risk is a warning, not a status.

## 6. Authentication and Account Management

### 6.1 Supported Authentication

StudyFlow supports:

- Email plus password.
- Google OpenID Connect.

After either method succeeds, FastAPI creates the same kind of server-managed StudyFlow session.

### 6.2 Email/Password Registration

- Email is the login identifier.
- Email comparison is consistent and case-insensitive according to the application's documented canonicalization policy.
- Passwords are hashed with Argon2id.
- Password minimum: 12 characters.
- Password maximum: at least 64 characters.
- Spaces and Unicode are allowed.
- Do not impose forced composition rules.
- Do not require periodic password changes.
- Reject known breached passwords.

### 6.3 Email Verification

Email/password accounts remain unusable until verification succeeds.

- Create the account in an unverified state.
- Send a cryptographically random verification token.
- Store only the token hash.
- Token is single-use.
- Token expires after eight hours.
- Rate-limit verification and resend attempts.
- An unverified account has no application access other than resending verification.

### 6.4 Password Recovery

- Provide "Forgot password."
- Return non-enumerating responses.
- Use a cryptographically random, stored-as-hash, single-use, expiring email token.
- Rate-limit reset requests and attempts.
- Revoke all active sessions after successful password reset.

### 6.5 Google Sign-In

- Use Google OpenID Connect's server authorization-code flow.
- Request only `openid`, `email`, and `profile`.
- Require Google's `email_verified=true`.
- Do not request Calendar scopes.
- Do not retain Google refresh tokens.
- After identity validation, create a normal server-managed StudyFlow session.

If Google returns an email matching an existing password account, do not link automatically. Require the existing password once, then link the Google identity.

### 6.6 Session Architecture

- React and FastAPI are served from one HTTPS origin.
- Authentication uses a cryptographically random opaque session identifier.
- Store the session record server-side.
- Store only an appropriately protected representation of the identifier server-side.
- Cookie name uses the `__Host-` prefix.
- Cookie attributes: `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`.
- Never store authentication tokens in `localStorage` or `sessionStorage`.
- Protect state-changing requests with CSRF tokens.
- Rotate sessions after login and authentication-sensitive events.
- Revoke sessions on logout.
- Session expires after 24 hours of inactivity or seven total days, whichever occurs first.
- Password changes and resets revoke all active sessions.

The application does not provide an active-device list or device-management controls.

JWT browser authentication is rejected for the approved browser-only scope.

### 6.7 Account Settings

Students may manage:

- Name.
- Password.
- Linked Google identity.
- Account Timezone.
- Preferred Session Length.
- Minimum Break.
- Sign out.

Account deletion is not supported because it is not explicitly required by the proposal. Student-owned planning records remain deletable.

### 6.8 Authentication Email Delivery

- Email delivery exists only to support verification and password recovery.
- Use a replaceable provider interface.
- Provider selection, a dedicated email-management module, deliverability dashboards, and provider-specific infrastructure are not product requirements.

## 7. Academic Tasks

### 7.1 Fields

Required:

- Title.
- Category.
- Deadline date and time.
- Priority.
- Original Estimate in exact minutes.

Optional:

- Course: maximum 100 characters.
- Notes: plain text, maximum 2,000 characters.

Course and Notes:

- Are for organization, grouping, filtering, and display.
- Do not affect scheduling.
- Do not affect adaptive estimation.
- Do not support rich text or attachments.

### 7.2 Categories

Categories are fixed:

- Assignment.
- Reading.
- Exam Preparation.
- Project.
- Research/Writing.
- Other.

Arbitrary tags and user-created model categories are excluded.

### 7.3 Priority

- Values: Low, Medium, High.
- Default: Medium.
- Represents importance, not deadline proximity.
- Urgency derived from Deadline and remaining workload takes precedence.

### 7.4 Estimate Editing

- Original Estimate may be edited before the first Study Session begins.
- Once work starts, freeze Original Estimate.
- Later corrections to outstanding work are recorded through Delayed outcomes and revised remaining minutes.
- Preserve predictions used for historical evaluation; do not retroactively rewrite them.

### 7.5 Task Completion

A task becomes Completed when:

- All planned work is completed; or
- The student explicitly selects "Task finished early."

"Task finished early":

- Requires confirmation.
- Sets remaining work to zero.
- Removes future sessions.
- Preserves Actual Duration already recorded.

### 7.6 Overdue Tasks

When a Deadline passes with remaining work:

- Derive status Overdue.
- Keep remaining work Unscheduled.
- Never silently schedule it after the Deadline.
- Require a new future Deadline before scheduling it again.

### 7.7 Deadline Changes

- Active scheduling uses the newest Deadline.
- Preserve Deadline history.
- A changed earlier Deadline may produce Overload.
- If a Deadline change invalidates a future session, remove that invalid session and mark its work Unscheduled.
- The student may then request schedule regeneration.

### 7.8 Task Deletion

Task deletion is always available after confirmation.

Deleting a task removes:

- The task.
- Associated sessions.
- Completion records.
- Associated behavior history.

After deletion:

- Recalculate adaptive-estimation eligibility and metrics without the deleted history.
- Leave unaffected future sessions unchanged.
- The student may request schedule regeneration when deletion changes the desired plan.

## 8. Availability and Time Semantics

### 8.1 Availability Windows

- Students define recurring weekly Availability Windows.
- Windows may cross midnight while appearing as one user-visible window.
- Overlapping or touching windows merge automatically.
- Example: Monday 6–8 PM plus Monday 8–10 PM becomes Monday 6–10 PM.

### 8.2 Unavailable Periods

- Unavailable Periods are dated exceptions.
- They override recurring Availability Windows.
- If a new exception invalidates a future session, remove that session and mark its work Unscheduled.
- The student may then request schedule regeneration.

### 8.3 Timezone Changes

When Account Timezone changes:

- Preserve each Deadline's real-world instant.
- Convert its displayed local date/time.
- Require the student to confirm recurring Availability Windows in the new timezone.
- Remove any future session made invalid by the confirmed conversion and mark its work Unscheduled.
- The student may then request schedule regeneration.

### 8.4 Hard Time Rules

No accepted or generated session may:

- Use time outside Availability Windows.
- Use an Unavailable Period.
- Overlap another session.
- Enter the past.
- Cross its task Deadline.
- Violate Minimum Break.

## 9. Session Preferences and Splitting

### 9.1 General Rule

Every Academic Task becomes one or more Study Sessions:

- If Planned Duration fits the Preferred Session Length, create one session.
- Otherwise split it.
- Represent duration in exact whole minutes.
- Preserve exact total minutes; never round workload upward.
- Do not impose a 15-minute duration grid.
- Permit the final session to be shorter than the Preferred Session Length.

Example:

- 130 total minutes.
- Maximum 60.
- Split: 60, 60, 10.

### 9.2 Account Preferences

Account defaults:

- Preferred Session Length: 60 minutes.
- Minimum Break: 10 minutes.

Allowed settings:

- Preferred Session Length: 10–240 minutes.
- Minimum Break: 0–120 minutes.

### 9.3 Breaks

- Minimum Break applies between all consecutive sessions, including sessions of the same task.
- Breaks consume otherwise available capacity.
- Students may set Minimum Break to zero.

## 10. Scheduling Engine

### 10.1 Authoritative Engine

Google OR-Tools CP-SAT is the authoritative scheduler.

### 10.2 Hard Constraints

The scheduler must enforce:

- Availability.
- Unavailable periods.
- No overlap.
- Deadlines.
- Preferred Session Length, except for an exact final remainder.
- Exact total workload.
- Minimum Break.
- No scheduling in the past.

### 10.3 Scheduling Policy

When all work is feasible:

- Schedule every active task through its latest Deadline.
- Prefer earlier placement to preserve recovery time.
- Distribute long-task sessions across available days instead of packing everything into the earliest day.

When capacity is insufficient:

1. Least scheduling slack wins.
2. Deadline urgency and remaining workload outrank Priority.
3. Priority breaks close cases.

A low-priority task due tomorrow can therefore outrank a high-priority task due next month.

### 10.4 Feasibility

- Never place sessions after deadlines.
- Schedule the feasible portion.
- Leave excess as Unscheduled Work.
- Return Overload rather than an invalid plan.

### 10.5 Overload Explanation

An Overload explanation must include:

- Affected task.
- Deadline.
- Required remaining minutes.
- Available minutes before Deadline.
- Exact shortfall.
- Relevant Unavailable Periods.
- Student-controlled remedies:
  - Extend the Deadline.
  - Add availability.

StudyFlow never changes those constraints automatically.

### 10.6 Planning Horizon and Display

- Schedule all active tasks through their latest Deadline.
- Do not ignore distant work because it is outside the visible calendar.
- The desktop Calendar displays one weekly time grid.
- A "Next 14 Days" agenda provides a compact forward view.
- Mobile uses day and scrollable agenda layouts, not 14 columns.

### 10.7 CP-SAT Time Limit and Technical Failure

The complete schedule-generation request must finish within five seconds under the agreed test conditions:

- CP-SAT and response construction share the five-second budget.
- If CP-SAT times out or fails technically, return a clearly labeled technical failure.
- A technical failure never replaces the active schedule and is never reported as Overload.
- Proven infeasibility returns Overload.

## 11. Schedule Proposal Control

### 11.1 Initial Generation and Manual Regeneration

- Initial generation and student-requested regeneration create an inactive schedule proposal.
- The student may request regeneration after task, availability, timezone, or preference changes.
- Generated proposals never replace the active schedule automatically.

### 11.2 Acceptance and Rejection

- Preview the proposal's sessions, Unscheduled Work, and Overload warnings.
- Accepting replaces the active future schedule with the complete proposal.
- Rejecting leaves the active schedule unchanged.
- Partial acceptance and manual session placement are not supported.

## 12. Session Outcomes and Remaining Work

### 12.1 Outcome Entry

Past sessions require a student-confirmed outcome:

- Completed.
- Delayed.
- Missed.

If none is recorded:

- Mark Awaiting Outcome.
- Prompt the student.
- Treat work as still remaining.
- Add no behavior record.
- Never auto-mark Missed.

### 12.2 Completed

- Actual minutes required and greater than zero.
- Remaining minutes equal zero.
- Actual Duration may exceed Planned Duration.
- Unusually large manual entries should prompt confirmation but remain allowed.

### 12.3 Delayed

Collect:

- Actual minutes worked.
- Revised remaining minutes.

Both must be greater than zero.

Default revised remaining minutes to:

`planned session minutes - actual minutes worked`

Allow the student to correct that default because time spent does not prove equivalent work completed.

Example:

- Planned: 60.
- Worked: 40.
- Default remaining: 20.
- Student believes 35 are needed.
- Reschedule 35.

Saving Delayed automatically creates a proposed Schedule Revision for the revised remaining work.

### 12.4 Missed

- Actual minutes equal zero.
- Full planned work remains.
- Missed work triggers a Schedule Revision.

### 12.5 Task Actual Duration

Sum every positive actual-work record across Completed and Delayed sessions.

Example:

- 40 delayed.
- 55 completed.
- 30 completed.
- Task Actual Duration: 125 minutes.

## 13. Effort Progress

For each task, calculate:

`Effort Progress = Actual Duration / (Actual Duration + estimated remaining duration)`

Display:

- Effort Progress percentage.
- Actual minutes worked.
- Estimated minutes remaining.
- Completed-session count.
- Upcoming-session count.
- Task Status.

Clearly label that Effort Progress measures expected effort consumed, not content completion, quality, or grade.

## 14. Schedule Revisions

### 14.1 Triggers

Generate a proposed Schedule Revision after:

- Delayed outcome.
- Missed outcome.

Other planning changes do not trigger automatic revision. The student may request regeneration under Section 11.

### 14.2 Preview

Preview must show:

- Revision reason.
- Proposed future sessions.
- Unscheduled Work.
- Overload warnings.
- Accept and Reject.

Completed sessions never move or reappear.

### 14.3 Acceptance

- Revision is inactive until accepted.
- Accept the complete feasible revision.
- Partial acceptance is not supported because it can invalidate feasibility guarantees.
- A student who wants a different result may reject and request regeneration after changing planning inputs.

### 14.4 Rejection

- Rejecting leaves existing valid future sessions unchanged.
- The Delayed or Missed session's unfinished work remains Unscheduled.
- Continue showing the unresolved-work warning until the student accepts a valid revision or changes planning inputs.
- Browsable historical schedule versions are not retained as a product feature.

## 15. Adaptive Duration Estimation

### 15.1 Principles

- Never use future completion data to predict an earlier task.
- Preserve Original Estimate.
- Adaptive Estimate is absent, not copied from Original Estimate, before qualification.
- Planned Duration uses Original Estimate while adaptation is unavailable.
- Once qualified, Adaptive Estimate is the default.
- Student may select Original Estimate instead.
- No arbitrary third Planned Duration is allowed.
- Freeze the prediction used for a task when it is first scheduled.
- Later model retraining affects only new future predictions.

### 15.2 Correction Baseline: Cold Start and Activation

Tasks 1–5:

- Collect completed behavior.
- Adaptive Estimate remains unavailable.
- Scheduling uses Original Estimate.

Tasks 6–10:

- Generate hidden chronological correction predictions.
- Do not expose them to the student.

After task 10:

- Evaluate the five hidden predictions.
- Activate the correction Adaptive Estimate only if its MAE is at least 10% lower than Original Estimate MAE on the same tasks.
- Otherwise keep Adaptive Estimate unavailable.
- Reassess after later completions.

### 15.3 Correction Formula

For each completed task:

`ratio = Actual Duration / Original Estimate`

Correction factor:

- Median ratio from the latest 20 applicable completed records.
- Use category-specific history when at least five completed tasks exist in that Category.
- Otherwise use overall student history.
- Do not use Course or Notes.
- Do not cap the factor.

Prediction:

`Adaptive Estimate = Original Estimate × median correction factor`

Why median:

- A single extreme or erroneous record does not dominate.
- Repeated genuine underestimation, including 4× behavior, remains learnable.

### 15.4 Large Adjustment Acknowledgment

When a Category first produces an Adaptive Estimate:

- Greater than 2× Original Estimate; or
- Less than 0.5× Original Estimate;

StudyFlow must:

- Explain the relevant history.
- Ask whether to use Adaptive or Original for scheduling.
- Preserve the uncapped Adaptive value.

After the student acknowledges that Category:

- Continue showing the explanation.
- Do not repeatedly block normal task creation for the same established pattern.
- Require acknowledgment again only if the adjustment factor changes substantially; the precise material-change threshold remains an implementation acceptance detail.

### 15.5 Continued Qualification

After activation:

- Re-evaluate after every completed task.
- Use the latest 10 eligible chronological predictions when 10 are available; otherwise use every hidden eligible prediction, with a minimum of five.
- The correction method must maintain a 10% MAE advantage over Original Estimates on the same tasks.
- If it loses qualification, Adaptive Estimate becomes unavailable and Planned Duration uses Original Estimate.

This change affects new predictions only; existing task predictions remain frozen.

### 15.6 Explanation

For any Adaptive Estimate, show:

- Original Estimate.
- Adaptive Estimate.
- A short explanation that it is based on the student's earlier completion history.
- The Planned Duration selected for scheduling.

Do not expose MAE, signed bias, prediction errors, eligible sample counts, or other model-accuracy analytics in the student interface.

## 16. Internal Estimation Evaluation

The following calculations are required for adaptive qualification and thesis evaluation, not as student-facing product analytics.

### 16.1 Per-Task Evaluation Record

For each completed eligible task, retain internally:

- Original Estimate.
- Adaptive Estimate if it existed before the task.
- Planned Duration source.
- Actual Duration.
- Signed estimation error.
- Absolute estimation error.

### 16.2 Aggregate Evaluation

Calculate internally:

- Original Estimate MAE.
- Adaptive Estimate MAE.
- Signed estimation bias.
- Eligible sample count.

Fairness requirements:

- Compare Original and Adaptive only on the same eligible tasks.
- Do not generate historical Adaptive Estimates retrospectively.
- Use only information available before each prediction.
- Sessions without a confirmed Actual Duration remain pending and are not treated as zero-duration completions.

Static-versus-adaptive schedule comparison belongs to technical evaluation tooling using identical task snapshots. Students see one active schedule and no model-accuracy dashboard.

## 17. Navigation and User Interface

### 17.1 Main Navigation

- Dashboard.
- Calendar.
- Tasks.
- Availability.
- Progress.
- Settings.

### 17.2 Dashboard

Dashboard is the default landing page and answers, "What needs attention now?"

Show:

- Next session.
- Today's remaining workload.
- Upcoming Deadlines.
- Overload warnings.
- Unscheduled Work.
- Awaiting Outcomes.
- Weekly Effort Progress.
- Quick Add Task.
- Links to detailed Calendar, Tasks, and Progress views.

### 17.3 Calendar

Calendar is the operational planning workspace.

Desktop:

- One-week time grid.
- Previous/next week.
- Today.
- Date picker.
- Next-14-days agenda.
- Unavailable time shaded.

Mobile:

- Day view.
- Scrollable agenda.
- No 14-column layout.

Calendar task access:

- `+ Task` opens the shared task form.
- Task sidebar shows active, Unscheduled, Overdue, and completed tasks.
- Clicking a session opens a task/session drawer.
- Drawer actions: view/edit task, delete task, and Record Outcome.
- Clicking Unscheduled Work opens its explanation and remedies.
- Desktop uses a side drawer.
- Mobile uses a bottom sheet.

The Calendar and Tasks pages must reuse the same forms, validation, and application commands.

### 17.4 Tasks

Tasks provides complete management and bulk browsing:

- Create, view, update, delete.
- Filter by Course.
- Filter by Category.
- Filter by Task Status.
- Filter by Deadline.
- Filter by Priority.
- View Planned Duration, Actual Duration, and estimated remaining duration.
- View task session history.

### 17.5 Availability

- Manage recurring weekly Availability Windows.
- Manage dated Unavailable Periods.
- Display future sessions invalidated by a saved availability change.
- Allow the student to request schedule regeneration.

### 17.6 Progress

- Task Effort Progress.
- Completed-session history.
- Actual minutes worked.
- Estimated minutes remaining.
- Completed-session and upcoming-session counts.
- Task Status.

### 17.7 Settings

- Name.
- Password management.
- Linked Google identity.
- Account Timezone.
- Preferred Session Length.
- Minimum Break.
- Sign out.

## 18. Privacy and Deletion

### 18.1 Data Minimization

Collect only:

- Authentication identity.
- Planning preferences.
- Tasks and optional organizational text.
- Availability.
- Sessions and outcomes.
- Actual-duration behavior.
- Active schedules and proposed revisions.
- Technical records required for security and evaluation.

Course and Notes are optional. The application does not require confidential academic content.

### 18.2 User-Controlled Record Deletion

Students may delete their own tasks and associated planning/behavior records.

Account deletion is not supported.

### 18.3 Cross-User Isolation

All cross-user access tests must pass for:

- Tasks.
- Availability.
- Unavailable periods.
- Sessions.
- Active schedules and proposed revisions.
- Outcomes.
- Behavior records.
- Progress and internal estimation-evaluation records.

## 19. Non-Functional Requirements

### 19.1 Security

**NFR-01:** All student-owned resources shall be protected by server-side authentication and authorization, and every tested cross-user access attempt shall fail without disclosing another student's data.

- All authorization server-side.
- Cross-user access denied in every tested endpoint.
- Argon2id password hashing.
- Verified-email gating.
- Secure OIDC validation.
- Secure server sessions.
- CSRF protection.
- Rate limits on authentication, verification, and recovery.
- Non-enumerating authentication responses where applicable.
- No authentication secrets in browser storage.

### 19.2 Performance

**NFR-02:** Under documented warm test conditions, main pages shall become usable within three seconds and schedule-generation responses shall complete within five seconds at the 95th percentile.

Page requirement:

- 95th percentile under three seconds.
- Measure from navigation until main content is usable.
- 20 runs.
- Production-like warm deployment.
- Seeded representative data.

Schedule-generation requirement:

- Complete response under five seconds.
- Test dataset:
  - One student.
  - 50 active tasks.
  - Up to 250 sessions.
  - 16-week horizon.
  - 50 unavailable periods.
  - Feasible and overloaded scenarios.

Render Free cold-start latency is explicitly excluded from the warm performance measurement and documented as a free-hosting limitation.

### 19.3 Reliability

**NFR-03:** Generated and accepted schedules shall contain no hard-constraint conflicts. Infeasible workloads shall produce explicit Overload and Unscheduled Work rather than an invalid schedule.

- No hard-constraint violation in generated or accepted schedules.
- Infeasible work returns Overload, not an invalid plan.
- Invalidated existing sessions become Unscheduled Work.
- Solver timeout or technical failure leaves the active schedule unchanged and is not mislabeled as Overload.

Successful missed-session recovery means:

- All remaining work receives valid sessions before Deadlines.
- No unavailable-time conflict.
- No overlap.
- If any work remains Unscheduled, recovery is unsuccessful and must include Overload explanation.

### 19.4 Usability

**NFR-04:** At least four of five representative university students shall complete the defined task-to-schedule workflow without assistance.

- Main workflow must be clear without assistance.
- Duration/outcome entry must remain low friction.
- Automatic changes require preview and acceptance.
- Explanations must be understandable and actionable.

### 19.5 Compatibility and Accessibility

**NFR-05:** Core workflows shall remain usable at 360, 768, and 1440 CSS pixels and in the latest stable versions of Chrome, Edge, and Safari, with keyboard-operable controls and visible focus.

- Latest stable version of Chrome.
- Latest stable version of Edge.
- Latest stable version of Safari.
- Responsive at 360, 768, and 1440 CSS pixels.
- Mobile Chrome and Safari responsive testing.

WCAG 2.2 AA is a nice-to-have, not a release blocker.

Basic accessible behavior remains required as ordinary quality:

- Keyboard-operable workflows.
- Labels and accessible names.
- Visible focus.
- Adequate contrast.
- Status not communicated by color alone.

### 19.6 Privacy

**NFR-06:** The system shall collect only personal data necessary for authentication, planning, security, and evaluation, and allow students to view, update, or delete their supported planning records without affecting another student's records. Account deletion is excluded.

Evidence uses the data inventory, deletion tests, and cross-user ownership tests defined in Section 18.

## 20. Architecture and Technology

### 20.1 Frontend

- React.
- TypeScript.
- Vite.
- Shared task/session form components across pages.
- Responsive weekly Calendar and mobile agenda.

### 20.2 Backend

- Python.
- FastAPI.
- REST API.
- OpenAPI documentation.
- Server-side authorization.
- Scheduling orchestration.
- Estimation orchestration.
- Google OIDC integration and minimal authentication-email delivery.

### 20.3 Database

- PostgreSQL.
- SQLAlchemy.
- Alembic.
- Store accounts, identities, sessions, tasks, availability, active schedules, proposed revisions, study sessions, outcomes, and behavior records.

### 20.4 Scheduling

- Google OR-Tools CP-SAT.
- Safe timeout and technical-failure handling under Section 10.7.

### 20.5 Estimation

- Python.
- Transparent median correction baseline.
- Chronological prediction/evaluation only.

### 20.6 Testing

- Pytest.
- Vitest.
- React Testing Library.
- Playwright.

### 20.7 Deployment

Zero-cost deployment:

- Render Free for the Dockerized React/FastAPI service.
- Neon Free for managed PostgreSQL.

Authentication-email provider selection remains an environment configuration choice rather than a product requirement.

Known limitation:

- Render Free sleeps after inactivity and can incur a cold start.
- Wake it before demonstrations.
- Document the limitation.

### 20.8 Backups

Required:

- Manual backup before each review/demo.
- At least one documented restore test.

Nice to have:

- Automated daily managed backups.

## 21. Continuous Integration

Every push:

- Lint.
- Type-check.
- Backend unit tests.
- Frontend unit tests.
- Migration validation.

Pull request and main:

- Docker build.
- One minimal Playwright task-to-schedule smoke test.

Nightly and pre-review:

- Full E2E.
- Browser compatibility.
- Performance.
- Security.

Full E2E is not required on every pushed commit.

## 22. Requirements Traceability

Maintain a matrix mapping:

- FR-01 through FR-09.
- NFR-01 through NFR-06.

Each row must link to:

- Implementation location.
- Automated test evidence.
- Manual/evaluation evidence where applicable.

A requirement is not complete without evidence.

## 23. Revised Requirement Mapping

### FR-01: Secure Account

Covered by Sections 6, 18, and 19.1.

### FR-02: Academic Task CRUD

Covered by Sections 7 and 17.4.

### FR-03: Availability

Covered by Sections 8 and 17.5.

### FR-04: Task Splitting

Covered by Sections 9 and 10.

### FR-05: Constraint-Based Scheduling

Covered by Sections 10 and 11.

### FR-06: Session Outcomes, Actual Duration, and Effort Progress

Covered by Sections 12, 13, and 17.6.

### FR-07: Qualified Personal Correction

Covered by Sections 15, 16, and 24.6.

### FR-08: Overload Detection and Explanation

Covered by Sections 10.4 and 10.5.

### FR-09: Delayed/Missed Work Revision

Covered by Section 14.

## 24. Separate Thesis Evaluation Decisions

These decisions were discussed and accepted but are not product features or in-product feedback functionality.

### 24.1 Usability Participants

- At least 5 representative university students.
- The 80% threshold means at least 4 of 5 complete the main workflow without assistance.
- Because each participant represents 20 percentage points, report the limited statistical stability of the result.

### 24.2 Main Evaluated Workflow

1. Set weekly availability.
2. Create an Academic Task.
3. Generate and accept a schedule.
4. Record a Session Outcome and Actual Duration.
5. View updated Effort Progress.

Registration, email verification, password recovery, and Google setup are excluded from this core usability metric.

### 24.3 External Feedback Collection

Do not build surveys or feedback into StudyFlow.

Use external tools for:

- Consent.
- Standard 10-item System Usability Scale.
- Five-point ratings for realism, explanation clarity, trust, usefulness, and rescheduling satisfaction.
- Optional comments.
- Observer records of assistance, task time, errors, and success.

StudyFlow may export consented technical metrics using pseudonymous participant codes.

### 24.4 Evaluation Data Access

- Do not add an admin role or admin dashboard.
- Use a documented backend export command against a dedicated evaluation environment.

### 24.5 Participant Data

- Provide realistic sample tasks.
- Personal examples are voluntary.
- No confidential academic content is required.
- Use pseudonymous participant identifiers.

### 24.6 Static vs Adaptive Technical Comparison

Use identical tasks, deadlines, and availability.

Measure:

- Original-versus-Adaptive MAE.
- Signed estimation bias.
- Hard-constraint violations.
- Deadline feasibility.
- Overload identification.
- Successful recovery after Missed sessions.
- Schedule-generation time.
- Schedule stability/change metrics.

Schedule-change metrics:

- Sessions moved.
- Total absolute minutes shifted.
- Sessions added.
- Sessions removed.
- Minutes left Unscheduled.

These metrics measure replanning disruption and recovery cost. They do not prove model superiority alone and must be interpreted with accuracy, feasibility, performance, and trust feedback.

## 25. Rejected or Superseded Decisions

- Presentation or original proposal as the current requirements authority: superseded by the approved revised baseline in Section 2.1.
- Three completed tasks as sufficient adaptive history: rejected.
- Fifteen-minute duration rounding: rejected; exact whole minutes are preserved.
- Copy Original Estimate into Adaptive Estimate during cold start: rejected; Adaptive is unavailable.
- Hard 0.5×–2× correction cap: rejected; use an uncapped robust median plus acknowledgment.
- Arbitrary third Planned Duration: rejected.
- Automatic Missed status when no outcome is recorded: rejected.
- Study Timer: removed from the binding scope; Actual Duration uses manual entry.
- Sessions after Deadline during Overload: rejected.
- Silent automatic rescheduling: rejected.
- Partial Schedule Revision acceptance: rejected.
- Automatic revisions for changes other than Delayed or Missed outcomes: superseded by student-requested regeneration.
- Manual session movement, drag-and-drop, and pinning: removed from the binding scope.
- Browsable immutable schedule history and direct restoration: removed from the binding scope.
- Deterministic scheduling fallback: superseded by safe technical-failure handling.
- Two simultaneous daily static/adaptive schedules: rejected.
- JWT browser authentication: rejected.
- Automatic Google/password account linking: rejected.
- Unverified password-account access: rejected.
- Ridge Regression and competing adaptive methods: superseded by one transparent correction method.
- Student-facing estimation-error and model-accuracy analytics: removed; retained only as internal evaluation.
- Account deletion: excluded because not required.
- Required reminder/notification system: rejected as out of scope.
- Required offline/PWA support: rejected as out of scope.
- Formal WCAG 2.2 AA release gate: rejected; retained as nice to have.
- Paid Render plus Render PostgreSQL: rejected for cost.
- Render Free PostgreSQL: rejected because it expires.
- Mandatory daily backups with seven-day retention: proposed, then superseded by required pre-review backups and an optional automated-daily-backup goal.
- Full E2E on every push: rejected.
- In-product research feedback module: rejected.
- Deterministic two-student demonstration seed data: proposed, then withdrawn before acceptance because demonstration planning was outside the software-building focus.
- Separate generic Dashboard removal: rejected; Dashboard retained as glanceable landing page.

## 26. Existing Decision Records

The following ADRs complement this specification subject to the stated revisions:

- `docs/adr/0001-stage-and-performance-gate-adaptive-estimation.md`: normative only for the transparent correction baseline and its qualification gate; all Ridge Regression decisions are superseded.
- `docs/adr/0002-use-server-managed-browser-sessions.md`: remains normative, except active-device management is not required.
- `docs/adr/0003-preserve-accepted-schedule-versions.md`: superseded by the active-schedule and single-proposal model.
- `docs/adr/0004-fallback-only-when-cp-sat-cannot-conclude.md`: superseded by safe technical-failure handling without fallback.
- `docs/adr/0005-use-zero-cost-render-and-neon-deployment.md`: remains normative for Render and Neon; the named email provider is no longer a product requirement.

## 27. Completion Boundary

Core software is complete only when:

- FR-01 through FR-09 are implemented.
- NFR-01 through NFR-06 have evidence under their agreed test conditions.
- All hard scheduling invariants pass.
- The personal correction method remains unavailable until performance-qualified.
- Cross-user authorization tests all pass.
- The complete task-to-schedule-to-outcome-to-progress workflow works at desktop and 360px width.
- Section 3 exclusions remain excluded.
- Nice-to-have items do not block core delivery.
