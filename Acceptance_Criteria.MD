# Acceptance Criteria

## Test baseline

- “Main pages”: Dashboard, Calendar, Tasks, Availability, and Progress.
- Valid duration: positive integer minutes.
- Current browsers: latest stable Chrome, Edge, and Safari at test time; record versions.
- Performance profile: production-like warm deployment, one student, 50 active tasks, up to 250 study sessions, a 16-week horizon, 50 unavailable periods, feasible and overloaded scenarios, one unmeasured warm-up, and 20 measured runs.
- Performance thresholds apply to the 95th percentile.
- “Representative users”: at least 5 KIT students unfamiliar with StudyFlow.
- A hard conflict means a session overlaps unavailable time, another session, or falls outside defined availability.

## Functional acceptance criteria

### FR-01 — Account management

- **FR-01-AC01:** Given valid unique registration data, when a student registers and verifies their email, then the account is usable and an authenticated session begins; before verification the account has no application access other than resending verification.
- **FR-01-AC02:** Given invalid or duplicate registration data, when registration is submitted, then no account is created and field-specific errors are displayed.
- **FR-01-AC03:** Given correct credentials, when the student signs in, then access is granted to their account.
- **FR-01-AC04:** Given incorrect credentials, when sign-in is attempted, then access is denied without identifying which credential was incorrect.
- **FR-01-AC05:** Given an authenticated student, when they update valid profile information, then the changes persist after reloading.
- **FR-01-AC06:** Given an authenticated student, when they sign out, then the session is invalidated and protected pages require authentication.

### FR-02 — Academic tasks

- **FR-02-AC01:** Given valid title, category, deadline, priority, and estimated duration, when a task is created, then it appears with those values.
- **FR-02-AC02:** Given a saved task, when the owner opens it, then all stored details are displayed.
- **FR-02-AC03:** Given a saved task, when the owner updates its details with valid values, then the changes persist.
- **FR-02-AC04:** Given a saved task, when the owner confirms deletion, then the task, its sessions, completion records, and behavior history are removed, adaptive-estimation eligibility and metrics are recalculated without that history, and unaffected future sessions are unchanged.
- **FR-02-AC05:** Given missing required fields, an invalid deadline, unsupported priority, or non-positive duration, when the form is submitted, then the task is rejected with validation errors.

### FR-03 — Availability

- **FR-03-AC01:** Given valid weekdays and start/end times, when recurring availability is saved, then it recurs on the selected weekdays.
- **FR-03-AC02:** Given a valid date and time range, when an unavailable period is added, then it overrides recurring availability for that period.
- **FR-03-AC03:** Given existing availability, when it is updated or deleted, then subsequent schedule generation uses the new definition.
- **FR-03-AC04:** Given an unavailable period whose end is not later than its start, or that ends in the past, when it is submitted, then it is rejected with an error. A recurring window whose end time is earlier than its start time is accepted as one window that crosses midnight.
- **FR-03-AC05:** Given a saved availability, unavailable-period, or timezone change that invalidates future sessions, then those sessions are removed, their work is shown as Unscheduled, and the student can request schedule regeneration.

### FR-04 — Task division

- **FR-04-AC01:** Given a task whose duration exceeds the preferred session duration, when sessions are generated, then the task is divided into multiple sessions.
- **FR-04-AC02:** Given generated sessions, then their total planned duration equals the task’s remaining workload.
- **FR-04-AC03:** Each session respects the preferred maximum duration, except a final remainder explicitly permitted by the session preferences.
- **FR-04-AC04:** Given a task shorter than or equal to the preferred duration, when divided, then exactly one session is produced.

### FR-05 — Schedule generation

- **FR-05-AC01:** Given feasible tasks and availability, when a schedule is generated, then every session is placed within available time without overlap.
- **FR-05-AC02:** Given sufficient capacity, then all required workload is scheduled no later than its deadline.
- **FR-05-AC03:** Given otherwise equivalent tasks with different deadlines, then the earlier-deadline task is scheduled first.
- **FR-05-AC04:** Given otherwise equivalent tasks with different priorities and insufficient capacity, then the higher-priority task is scheduled first.
- **FR-05-AC05:** Given partially completed tasks, then only their remaining workload is scheduled.

### FR-06 — Session outcomes

- **FR-06-AC01:** Given a planned session, when it is marked completed, delayed, or missed, then that status persists.
- **FR-06-AC02:** Given a valid positive actual duration, when it is recorded, then it persists and is linked to the correct session.
- **FR-06-AC03:** Given zero, negative, or nonnumeric actual duration, when submitted, then it is rejected.
- **FR-06-AC04:** Given a completed session, then its planned work is removed from the task’s remaining workload; a delayed session leaves the student’s revised remaining minutes outstanding, and a missed session leaves all of its planned work outstanding.
- **FR-06-AC05:** Given recorded work and estimated remaining duration, then Effort Progress is calculated as `Actual Duration / (Actual Duration + estimated remaining duration)` and displays the percentage, actual minutes worked, estimated minutes remaining, completed-session count, upcoming-session count, and task status.
- **FR-06-AC06:** Effort Progress is clearly labeled as expected effort consumed, not content completion, quality, or grade.
- **FR-06-AC07:** Sessions without a confirmed actual duration remain pending and are not treated as zero-duration completions.

### FR-07 — Adaptive estimates

- **FR-07-AC01:** Given completed tasks with original estimates and actual durations, when a later estimate is generated, then only records completed before that task’s prediction are used.
- **FR-07-AC02:** Given a history where actual durations consistently exceed estimates, then the adaptive estimate is greater than the equivalent unadjusted estimate.
- **FR-07-AC03:** Given a history where actual durations consistently fall below estimates, then the adaptive estimate is lower than the equivalent unadjusted estimate.
- **FR-07-AC04:** Given insufficient history or a correction that has not shown at least a 10% MAE advantage over Original Estimates on the same tasks, then no Adaptive Estimate is shown and the Original Estimate is used for scheduling.
- **FR-07-AC05:** Repeating estimation with identical inputs and history produces the same result.
- **FR-07-AC06 (evaluation-only):** Original-versus-Adaptive comparison metrics are retained for adaptive-estimation qualification and thesis evaluation, but are not presented as student-facing estimation-error statistics or model-accuracy analytics.

### FR-08 — Overload detection

- **FR-08-AC01:** Given required workload greater than available time before applicable deadlines, when scheduling runs, then the workload is identified as infeasible.
- **FR-08-AC02:** The warning states the affected task, its deadline, required remaining minutes, available minutes before the deadline, the exact shortfall, relevant unavailable periods, and the student-controlled remedies (extend the deadline or add availability); StudyFlow does not apply a remedy itself.
- **FR-08-AC03:** An infeasible workload produces a warning instead of a schedule that violates hard constraints.
- **FR-08-AC04:** Given workload equal to or below available capacity, then no overload warning is displayed.

### FR-09 — Automatic rescheduling

- **FR-09-AC01:** Given a session recorded as Delayed or Missed with future availability, then a proposed Schedule Revision places its unfinished work in valid future slots, and the revision replaces the active schedule only after the student accepts it.
- **FR-09-AC02:** Given a planning change other than a Delayed or Missed outcome (such as a deadline, availability, or timezone change), then no revision is generated automatically; invalidated future sessions become Unscheduled Work and the student may request regeneration.
- **FR-09-AC03:** Completed sessions are not moved or duplicated during rescheduling.
- **FR-09-AC04:** Rescheduled sessions contain no hard conflicts and do not exceed their task deadlines when a feasible solution exists.
- **FR-09-AC05:** Under limited capacity, urgency and priority determine which outstanding work is placed first.
- **FR-09-AC06:** If no feasible reschedule exists, then an overload explanation is shown instead of an invalid plan.
- **FR-09-AC07:** Given a rejected revision, then existing valid future sessions are unchanged and the unfinished work stays visible as Unscheduled until a valid revision is accepted or planning inputs change.

## Non-functional acceptance criteria

### NFR-01 — Security

- **NFR-01-AC01:** Given users A and B, when A requests B’s tasks, sessions, availability, progress, or account records through any API operation, then the request returns 404 and no data is disclosed or changed.
- **NFR-01-AC02:** Given an unauthenticated request to a protected resource, then it is rejected with 401.
- **NFR-01-AC03:** Authorization is enforced server-side even when identifiers or request payloads are manually altered.
- **NFR-01-AC04:** All automated cross-user access-control tests pass.

### NFR-02 — Performance

- **NFR-02-AC01:** Under the defined performance profile, each main page becomes usable within 3 seconds at the 95th percentile.
- **NFR-02-AC02:** Under the same profile, schedule generation completes within 5 seconds at the 95th percentile.
- **NFR-02-AC03:** No measured request fails because of server error or timeout during the benchmark.

### NFR-03 — Reliability

- **NFR-03-AC01:** Across the constraint test suite, no generated session overlaps unavailable time, another session, or time outside availability.
- **NFR-03-AC02:** For every feasible fixture, the scheduled duration equals the required remaining workload.
- **NFR-03-AC03:** For every infeasible fixture, the system returns a warning and does not return a hard-constraint-violating schedule.
- **NFR-03-AC04:** Repeated generation with identical inputs produces a valid result without data loss or duplicated sessions.

### NFR-04 — Usability

- **NFR-04-AC01:** At least 80% of representative participants (at least 4 of 5) independently complete: set weekly availability, create an Academic Task, generate and accept a schedule, record a session outcome and actual duration, and view updated Effort Progress. Registration, email verification, password recovery, and Google setup are excluded.
- **NFR-04-AC02:** No verbal, written, or operator assistance is provided after the workflow begins.
- **NFR-04-AC03:** Successes, failures, participant characteristics, and observed usability issues are recorded in the test report.

### NFR-05 — Compatibility

- **NFR-05-AC01:** At viewport widths of 360, 768, and 1440 pixels, all main pages remain readable and operable without unintended horizontal scrolling, overlap, or clipped controls.
- **NFR-05-AC02:** The main task-to-schedule workflow completes successfully in current Chrome, Edge, and Safari.
- **NFR-05-AC03:** Keyboard entry, forms, navigation, and status feedback remain functional in each tested browser.
- **NFR-05-AC04:** Browser names, versions, operating systems, and viewport sizes are recorded as test evidence.
- **NFR-05-AC05:** Core pages provide accessible names and labels for controls, visible focus, adequate text contrast, keyboard access to scrollable regions, and status cues that do not rely on color alone. Formal WCAG 2.2 AA conformance is not a release gate.

### NFR-06 — Privacy

- **NFR-06-AC01:** Every collected personal field appears in an approved data inventory with a documented planning purpose; no unlisted field is collected.
- **NFR-06-AC02:** A student can view and update each editable record they own, and changes persist.
- **NFR-06-AC03:** A student can delete their tasks, availability, sessions, and associated planning records.
- **NFR-06-AC04:** After deletion, removed records are inaccessible through the interface and API and are excluded from scheduling and estimation.
- **NFR-06-AC05:** Deleting or updating one student’s records does not affect another student’s records.
