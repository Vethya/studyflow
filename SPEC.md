# StudyFlow Software Specification

## 1. Document Status and Authority

This specification consolidates the StudyFlow proposal, presentation, and the product-design decisions resolved during the requirements grilling session.

The detailed proposal is authoritative when it differs from the presentation:

- `B11-P10_StudyFlow_Proposal.pdf` defines the binding FR-01 through FR-10 and NFR-01 through NFR-06 requirements.
- `B11-P10_StudyFlow_Presentation.pdf` is an explanatory summary.
- The proposal's exclusions remain binding unless this specification explicitly records an agreed addition.
- This specification resolves ambiguities left open by the proposal and presentation.

Source artifacts:

- `/Users/macbookpro/Documents/School/Kirirum Institute of Technology (KIT)/Year 4/Final Thesis/0th Review/B11-P10_StudyFlow_Proposal.pdf`
- `/Users/macbookpro/Documents/School/Kirirum Institute of Technology (KIT)/Year 4/Final Thesis/0th Review/B11-P10_StudyFlow_Presentation.pdf`

The product is a responsive web application for university students. Its core contribution is a behavior-adaptive scheduler that converts academic tasks into feasible study sessions, learns from estimated-versus-actual duration records, detects overload, and proposes controlled schedule revisions.

## 2. Product Goals

StudyFlow must:

1. Securely manage student accounts and student-owned planning data.
2. Convert academic tasks into manageable study sessions.
3. Generate schedules that respect deadlines, availability, pinned sessions, breaks, and session preferences.
4. Preserve student control over generated and revised schedules.
5. Record actual study behavior with low-friction manual entry and an optional timer.
6. Produce adaptive duration estimates only when personal evidence demonstrates that they are meaningfully more accurate.
7. Detect overload quantitatively and never disguise infeasible work as a valid schedule.
8. Show effort progress and transparent original-versus-adaptive-versus-actual comparisons.

## 3. Product Scope

### 3.1 Included

- Responsive React web application.
- Student registration, email verification, login, logout, password recovery, and account settings.
- Email/password authentication and Google Sign-In.
- Academic Task CRUD.
- Optional Course and Notes fields.
- Recurring weekly availability and dated unavailable periods.
- Session splitting with student-defined minimum and maximum lengths.
- Configurable breaks between sessions.
- OR-Tools CP-SAT schedule generation.
- Deterministic fallback scheduling when CP-SAT cannot conclude.
- Manual session movement and pinning.
- Completed, Delayed, and Missed outcomes.
- Awaiting Outcome handling.
- Optional hybrid Study Timer.
- Automatic but student-approved Schedule Revisions.
- Overload and Unscheduled Work explanations.
- Behavior-adaptive estimation with a correction baseline and Ridge Regression.
- Effort Progress and estimate-comparison views.
- Immutable accepted-schedule history.
- Responsive desktop and mobile-width workflows.

### 3.2 Explicitly Excluded

- Adviser, supervisor, administrator, or university-management application roles.
- Account deletion.
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

Basic accessibility quality remains expected even though formal WCAG conformance is optional: keyboard access, semantic labels, visible focus, adequate contrast, non-color status indicators, and non-drag alternatives.

## 4. Users and Ownership

### 4.1 User Type

The university student is the only direct application user type.

### 4.2 Ownership

Every task, availability record, unavailable period, session, timer, schedule version, behavior record, and progress record belongs to exactly one Student Account.

All ownership checks must be enforced server-side. Querying another student's resource identifier returns `404 Not Found`, preventing disclosure that the resource exists. Unauthenticated requests return `401 Unauthorized`.

## 5. Canonical Domain Language

The canonical glossary is maintained in `CONTEXT.md`. The following definitions are normative.

### 5.1 Accounts and Time

**Student Account**  
The student's identity and planning preferences. It includes name, password credentials when applicable, Account Timezone, session-length defaults, and Minimum Break.

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

**Pinned Session**  
A session manually placed by the student that Schedule Revision must not move until unpinned.

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
A proposed replacement for future sessions after tasks, availability, estimates, outcomes, or constraints change. It becomes active only after complete acceptance.

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
- Multiple devices are allowed.
- Track each device session independently.
- Provide "Sign out all devices."
- Password changes and resets revoke all device sessions.

JWT browser authentication is rejected for the approved browser-only scope.

### 6.7 Account Settings

Students may manage:

- Name.
- Password.
- Linked Google identity.
- Account Timezone.
- Preferred Session Length.
- Minimum Session Length.
- Minimum Break.
- Active sessions/devices and sign-out controls.

Account deletion is not supported because it is not explicitly required by the proposal. Student-owned planning records remain deletable.

### 6.8 Transactional Email

- Production/deployed email provider: Resend.
- Local development email capture: Mailpit.
- Verified sending domain: `studyflow.vethya.com`.
- Expected sender: `StudyFlow <no-reply@studyflow.vethya.com>`.
- Configure SPF and DKIM; configure DMARC.
- Use a provider interface so the implementation is replaceable.

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
- Minimum Session Length override.
- Preferred Session Length override.

Course and Notes:

- Are for organization, grouping, filtering, and display.
- Do not affect scheduling.
- Do not affect correction-baseline or Ridge estimation.
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
- Any Deadline change triggers a proposed Schedule Revision.
- A changed earlier Deadline may produce Overload.

### 7.8 Task Deletion

Task deletion is always available after confirmation.

Deleting a task removes:

- The task.
- Associated sessions.
- Completion records.
- Timer data.
- Associated behavior history.

After deletion:

- Recalculate adaptive-estimation eligibility and metrics without the deleted history.
- Recompute affected future scheduling through a Schedule Revision.

## 8. Availability and Time Semantics

### 8.1 Availability Windows

- Students define recurring weekly Availability Windows.
- Windows may cross midnight while appearing as one user-visible window.
- Overlapping or touching windows merge automatically.
- Example: Monday 6–8 PM plus Monday 8–10 PM becomes Monday 6–10 PM.

### 8.2 Unavailable Periods

- Unavailable Periods are dated exceptions.
- They override recurring Availability Windows.
- A one-time exception that conflicts with accepted future sessions triggers a Schedule Revision.

### 8.3 Timezone Changes

When Account Timezone changes:

- Preserve each Deadline's real-world instant.
- Convert its displayed local date/time.
- Require the student to confirm recurring Availability Windows in the new timezone.
- Trigger a Schedule Revision.

### 8.4 Hard Time Rules

No accepted or generated session may:

- Use time outside Availability Windows.
- Use an Unavailable Period.
- Overlap another session.
- Enter the past.
- Cross its task Deadline.
- Violate a Pinned Session.
- Violate Minimum Break.

## 9. Session Preferences and Splitting

### 9.1 General Rule

Every Academic Task becomes one or more Study Sessions:

- If Planned Duration fits the maximum, create one session.
- Otherwise split it.
- Represent duration in exact whole minutes.
- Preserve exact total minutes; never round workload upward.
- Do not impose a 15-minute duration grid.

Example:

- 130 total minutes.
- Maximum 60.
- No minimum consideration: 60, 60, 10.

### 9.2 Minimum and Maximum

Account defaults:

- Minimum Session Length: 20 minutes.
- Preferred Session Length (maximum): 60 minutes.
- Minimum Break: 10 minutes.

Allowed settings:

- Minimum Session Length: 5–120 minutes.
- Preferred maximum: 10–240 minutes.
- Minimum Break: 0–120 minutes.
- Require minimum less than or equal to maximum.

Task-level minimum and maximum overrides are optional. When absent, inherit account values.

### 9.3 Rebalancing

If naïve splitting leaves a final session shorter than the minimum:

- Rebalance sessions.
- Preserve exact total workload.
- Keep every session within minimum/maximum when possible.

Example:

- Total 130.
- Maximum 60.
- Minimum 20.
- Valid split: 60, 50, 20.
- Invalid split: 60, 60, 10.

If the entire task is shorter than the minimum, allow one exact short session.

### 9.4 Breaks

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
- Pinned sessions.
- Minimum session length, with the whole-task-shorter exception.
- Preferred maximum session length.
- Exact total workload.
- Minimum Break.
- No scheduling in the past.

### 10.3 Scheduling Policy

When all work is feasible:

- Schedule every active task through its latest Deadline.
- Prefer earlier placement to preserve recovery time.
- Distribute long-task sessions across available days instead of packing everything into the earliest day.
- Keep accepted Pinned Sessions unchanged.

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
- Relevant Pinned Sessions.
- Relevant Unavailable Periods.
- Student-controlled remedies:
  - Extend the Deadline.
  - Add availability.
  - Unpin sessions.

StudyFlow never changes those constraints automatically.

### 10.6 Planning Horizon and Display

- Schedule all active tasks through their latest Deadline.
- Do not ignore distant work because it is outside the visible calendar.
- The desktop Calendar displays one weekly time grid.
- A "Next 14 Days" agenda provides a compact forward view.
- Mobile uses day and scrollable agenda layouts, not 14 columns.

### 10.7 CP-SAT Time Limit and Fallback

The complete schedule-generation request must finish within five seconds under the agreed test conditions:

- CP-SAT receives up to four seconds.
- One second remains for fallback and response construction.

Fallback:

- Deterministic earliest-deadline-first greedy heuristic.
- Runs only when CP-SAT times out or fails technically.
- Must enforce all hard constraints.
- Produces a clearly labeled fallback proposal.
- Must not run to disguise a CP-SAT-proven infeasible workload.
- A proven infeasible workload returns Overload.

## 11. Manual Session Control

### 11.1 Moving Sessions

Students may move sessions through:

- Drag-and-drop on desktop Calendar.
- An "Edit time" form on desktop and mobile.

Both methods apply identical validation.

### 11.2 Pinning

- A manual move pins the session.
- Schedule Revisions cannot move it.
- The student may unpin it.
- Pinned sessions can contribute to Overload and must be named in the explanation.

Students cannot pin or move a session:

- Outside availability.
- Into unavailable time.
- Over another session.
- Into the past.
- Across/after its Deadline.

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

## 13. Study Timer

### 13.1 Hybrid Model

The timer is included but optional.

- Start, Pause, and Finish controls.
- Timer fills Actual Duration.
- Student confirms or edits the result.
- Manual duration entry always remains available.
- Timer completion never determines Session Outcome.
- The application need not remain open while studying.

### 13.2 Concurrency

- Only one active timer per Student Account.
- Starting another requires pausing or finishing the current timer.
- Enforce this across devices.

### 13.3 Persistence

- Record timer timestamps server-side.
- Closing the browser does not stop the timer.
- On return, show elapsed time and require confirmation.

### 13.4 Long Timer Handling

Flag a timer when:

- Elapsed time exceeds 60 minutes and twice the planned session length; or
- Elapsed time reaches four hours.

At four hours:

- If the app is open, show "Still studying?"
- "Continue" keeps it running.
- If the app is closed, keep recording.
- On return, flag and require confirmation/correction.
- Never silently pause, stop, or cap Actual Duration.

## 14. Schedule Revisions

### 14.1 Triggers

Generate a proposed Schedule Revision after:

- Task creation.
- Task update.
- Task deletion.
- Deadline change.
- Availability change.
- Unavailable-period change.
- Completed, Delayed, or Missed outcome.
- Planned estimate-source change.
- Pin or unpin.
- Account Timezone change.

### 14.2 Preview

Preview must show:

- Revision reason.
- Moved sessions.
- Old and new times for moved sessions.
- Added sessions.
- Removed sessions.
- Unscheduled Work.
- Overload warnings.
- Accept and Reject.

Pinned and completed sessions cannot move.

### 14.3 Acceptance

- Revision is inactive until accepted.
- Accept the complete feasible revision.
- Partial acceptance is not supported because it can invalidate feasibility guarantees.
- A student who wants different placement may reject, manually move/pin sessions, and regenerate.

### 14.4 Rejection and Invalid Existing Sessions

If the underlying change invalidates current sessions and the student rejects:

- Remove only invalid sessions from the active calendar.
- Convert their remaining work to Unscheduled Work.
- Preserve unaffected sessions.
- Continue showing the warning until resolved.

### 14.5 Version History

- Every accepted schedule is immutable.
- Store creation time and revision reason.
- New acceptance creates a new version.
- Show only the current accepted version as active.
- Allow inspection of old versions.
- Do not restore an old version directly; it may contain past or invalid placements.
- Regenerate under current constraints instead.

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

### 15.5 Ridge Regression Candidate

After 30 completed tasks:

- Begin generating hidden chronological Ridge predictions.
- Require 10 hidden predictions.
- Earliest Ridge activation is after task 40.

Ridge input features, all known before work:

- Original Estimate.
- Category.
- Priority.
- Recent overall estimation ratio.
- Recent category-specific estimation ratio.

Excluded Ridge inputs:

- Course.
- Notes.
- Future completion data.

Activate Ridge only when its MAE is at least 10% lower than:

- Original Estimate MAE; and
- Correction-baseline MAE;

on the same 10 eligible chronological predictions.

### 15.6 Continued Qualification and Fallback

After activation:

- Re-evaluate after every completed task.
- Use the latest 10 eligible chronological predictions.
- A method must maintain a 10% MAE advantage.
- If it loses qualification, fall back to the best qualifying method.
- If none qualifies, Adaptive Estimate becomes unavailable and Planned Duration uses Original Estimate.

This fallback affects new predictions only; existing task predictions remain frozen.

### 15.7 Explanation

For any Adaptive Estimate, show:

- Original Estimate.
- Adaptive Estimate.
- Number of prior records.
- Method status in understandable language.
- Strongest understandable factors, such as a Category's recent tendency to take longer.

Do not expose raw model coefficients in the normal student interface. They may be retained as technical evidence.

## 16. Progress and Estimate Comparison

### 16.1 Task Progress

Display:

- Effort Progress percentage.
- Actual minutes worked.
- Estimated minutes remaining.
- Completed-session count.
- Upcoming-session count.
- Task Status.

Clearly label that Effort Progress does not represent percentage of content written, quality, or grade.

### 16.2 Per-Task Estimate Comparison

For a completed eligible task, show:

- Original Estimate.
- Adaptive Estimate if it existed before the task.
- Planned Duration source.
- Actual Duration.
- Signed estimation error.
- Absolute estimation error.

### 16.3 Aggregate Comparison

Show:

- Original Estimate MAE.
- Adaptive Estimate MAE.
- Signed estimation bias.
- Eligible sample count.

Fairness requirements:

- Compare Original and Adaptive only on the same eligible tasks.
- Do not generate historical Adaptive Estimates retrospectively.
- Use only information available before each prediction.

### 16.4 Static vs Adaptive Schedules

Students do not see two competing daily schedules.

- The active product shows one accepted schedule.
- Planned Duration source determines that schedule.
- Static-versus-adaptive schedule comparison belongs to technical evaluation/test tooling using identical task snapshots.
- The student dashboard shows estimate differences, not two simultaneous plans.

## 17. Navigation and User Interface

### 17.1 Main Navigation

- Dashboard.
- Calendar.
- Tasks.
- Availability.
- Progress.
- Settings.

An active Study Timer remains globally visible.

### 17.2 Dashboard

Dashboard is the default landing page and answers, "What needs attention now?"

Show:

- Next session.
- Active timer.
- Today's remaining workload.
- Upcoming Deadlines.
- Overload warnings.
- Unscheduled Work.
- Awaiting Outcomes.
- Weekly Effort Progress.
- Latest estimate-accuracy summary.
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
- Drawer actions: view/edit task, delete task, Start Timer, Record Outcome, Move, Pin/Unpin.
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
- View Original, Adaptive, Planned, Actual, and remaining durations.
- View task session history.

### 17.5 Availability

- Manage recurring weekly Availability Windows.
- Manage dated Unavailable Periods.
- Display conflicts that will trigger Schedule Revision.

### 17.6 Progress

- Task Effort Progress.
- Completed-session history.
- Original/Adaptive/Actual comparisons.
- Aggregate MAE and signed bias.
- Sample counts and adaptation availability.

### 17.7 Settings

- Name.
- Password management.
- Linked Google identity.
- Account Timezone.
- Minimum Session Length.
- Preferred Session Length.
- Minimum Break.
- Active devices.
- Sign out current device.
- Sign out all devices.

## 18. Privacy and Deletion

### 18.1 Data Minimization

Collect only:

- Authentication identity.
- Planning preferences.
- Tasks and optional organizational text.
- Availability.
- Sessions and outcomes.
- Actual-duration behavior.
- Schedule versions.
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
- Timers.
- Schedule versions.
- Outcomes.
- Behavior records.
- Progress/estimate records.

## 19. Non-Functional Requirements

### 19.1 Security

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
  - 25 pinned sessions.
  - Feasible and overloaded scenarios.

Render Free cold-start latency is explicitly excluded from the warm performance measurement and documented as a free-hosting limitation.

### 19.3 Reliability

- No hard-constraint violation in generated or accepted schedules.
- Infeasible work returns Overload, not an invalid plan.
- Invalidated existing sessions become Unscheduled Work.
- Accepted schedule versions are immutable.
- Solver technical failure may use only the constrained fallback.

Successful missed-session recovery means:

- All remaining work receives valid sessions before Deadlines.
- No unavailable-time conflict.
- No overlap.
- If any work remains Unscheduled, recovery is unsuccessful and must include Overload explanation.

### 19.4 Usability

- Main workflow must be clear without assistance.
- Duration/outcome entry must remain low friction.
- Automatic changes require preview and acceptance.
- Explanations must be understandable and actionable.
- Manual alternatives must exist for timer entry and drag-and-drop.

### 19.5 Compatibility

- Latest two stable versions of Chrome.
- Latest two stable versions of Edge.
- Latest two stable versions of Safari.
- Responsive at 360px.
- Mobile Chrome and Safari responsive testing.

### 19.6 Accessibility

WCAG 2.2 AA is a nice-to-have, not a release blocker.

Basic accessible behavior remains required as ordinary quality:

- Keyboard-operable workflows.
- Labels and accessible names.
- Visible focus.
- Adequate contrast.
- Status not communicated by color alone.
- Edit-time alternative to dragging.

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
- Email and Google OIDC integration.

### 20.3 Database

- PostgreSQL.
- SQLAlchemy.
- Alembic.
- Store accounts, identities, sessions, tasks, availability, schedule versions, study sessions, outcomes, timers, and behavior records.

### 20.4 Scheduling

- Google OR-Tools CP-SAT.
- Deterministic greedy fallback under the constrained conditions in Section 10.7.

### 20.5 Estimation

- Python.
- Transparent median correction baseline.
- scikit-learn Ridge Regression after qualification.
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
- Resend Free for transactional email.

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

- FR-01 through FR-10.
- NFR-01 through NFR-06.

Each row must link to:

- Implementation location.
- Automated test evidence.
- Manual/evaluation evidence where applicable.

A requirement is not complete without evidence.

## 23. Proposal Requirement Mapping

### FR-01: Secure Account

Covered by Sections 6, 18, and 19.1.

### FR-02: Academic Task CRUD

Covered by Sections 7 and 17.4.

### FR-03: Availability

Covered by Sections 8 and 17.5.

### FR-04: Task Splitting

Covered by Sections 9 and 10.

### FR-05: Constraint-Based Scheduling

Covered by Sections 10, 11, and 14.

### FR-06: Session Status and Actual Duration

Covered by Sections 12 and 13.

### FR-07: Personalized Estimate Updates

Covered by Section 15.

### FR-08: Overload Detection and Explanation

Covered by Sections 10.4 and 10.5.

### FR-09: Automatic Rescheduling

Covered by Section 14.

### FR-10: Progress and Estimate Comparison

Covered by Sections 16 and 17.6.

## 24. Separate Thesis Evaluation Decisions

These decisions were discussed and accepted but are not product features or in-product feedback functionality.

### 24.1 Usability Participants

- At least 10 representative university students.
- The 80% threshold means at least 8 of 10 complete the main workflow without assistance.

### 24.2 Main Evaluated Workflow

1. Set weekly availability.
2. Create an Academic Task.
3. Generate and accept a schedule.
4. Record a Session Outcome and Actual Duration.
5. View updated Effort Progress and estimate comparison.

Registration, email verification, and Google setup are excluded from this core usability metric.

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

- Presentation as authoritative source: rejected; proposal is authoritative.
- Three completed tasks as sufficient adaptive history: rejected.
- Fifteen-minute duration rounding: rejected; exact whole minutes are preserved.
- Copy Original Estimate into Adaptive Estimate during cold start: rejected; Adaptive is unavailable.
- Hard 0.5×–2× correction cap: rejected; use an uncapped robust median plus acknowledgment.
- Arbitrary third Planned Duration: rejected.
- Automatic Missed status when no outcome is recorded: rejected.
- Timer-only duration tracking: rejected; hybrid timer/manual approach selected.
- Automatic four-hour timer stop: rejected; warn and confirm without silent stopping.
- Sessions after Deadline during Overload: rejected.
- Silent automatic rescheduling: rejected.
- Partial Schedule Revision acceptance: rejected.
- Direct restoration of old schedules: rejected.
- Two simultaneous daily static/adaptive schedules: rejected.
- JWT browser authentication: rejected.
- Automatic Google/password account linking: rejected.
- Unverified password-account access: rejected.
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

The following ADRs remain normative and complement this specification:

- `docs/adr/0001-stage-and-performance-gate-adaptive-estimation.md`
- `docs/adr/0002-use-server-managed-browser-sessions.md`
- `docs/adr/0003-preserve-accepted-schedule-versions.md`
- `docs/adr/0004-fallback-only-when-cp-sat-cannot-conclude.md`
- `docs/adr/0005-use-zero-cost-render-and-neon-deployment.md`

## 27. Completion Boundary

Core software is complete only when:

- FR-01 through FR-10 are implemented.
- NFR-01 through NFR-06 have evidence under their agreed test conditions.
- All hard scheduling invariants pass.
- Adaptive methods remain unavailable until performance-qualified.
- Cross-user authorization tests all pass.
- The complete task-to-schedule-to-outcome-to-progress workflow works at desktop and 360px width.
- Proposal exclusions remain excluded.
- Nice-to-have items do not block core delivery.
