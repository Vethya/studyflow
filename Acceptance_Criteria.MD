# Acceptance Criteria

## Test baseline

- “Main pages”: Dashboard, Tasks, Availability, Schedule, and Progress.
- Valid duration: positive integer minutes.
- Current browsers: latest stable Chrome, Edge, and Safari at test time; record versions.
- Performance profile: production-like build, seeded user with 100 tasks and 200 study sessions, 50 concurrent users, warm-up excluded, 100 measured runs.
- Performance thresholds apply to the 95th percentile.
- “Representative users”: at least 5 KIT students unfamiliar with StudyFlow.
- A hard conflict means a session overlaps unavailable time, another session, or falls outside defined availability.

## Functional acceptance criteria

### FR-01 — Account management

- **FR-01-AC01:** Given valid unique registration data, when a student registers, then an account is created and an authenticated session begins.
- **FR-01-AC02:** Given invalid or duplicate registration data, when registration is submitted, then no account is created and field-specific errors are displayed.
- **FR-01-AC03:** Given correct credentials, when the student signs in, then access is granted to their account.
- **FR-01-AC04:** Given incorrect credentials, when sign-in is attempted, then access is denied without identifying which credential was incorrect.
- **FR-01-AC05:** Given an authenticated student, when they update valid profile information, then the changes persist after reloading.
- **FR-01-AC06:** Given an authenticated student, when they sign out, then the session is invalidated and protected pages require authentication.

### FR-02 — Academic tasks

- **FR-02-AC01:** Given valid title, category, deadline, priority, and estimated duration, when a task is created, then it appears with those values.
- **FR-02-AC02:** Given a saved task, when the owner opens it, then all stored details are displayed.
- **FR-02-AC03:** Given a saved task, when the owner updates its details with valid values, then the changes persist.
- **FR-02-AC04:** Given a saved task, when the owner confirms deletion, then it and its uncompleted generated sessions are removed.
- **FR-02-AC05:** Given missing required fields, an invalid deadline, unsupported priority, or non-positive duration, when the form is submitted, then the task is rejected with validation errors.

### FR-03 — Availability

- **FR-03-AC01:** Given valid weekdays and start/end times, when recurring availability is saved, then it recurs on the selected weekdays.
- **FR-03-AC02:** Given a valid date and time range, when an unavailable period is added, then it overrides recurring availability for that period.
- **FR-03-AC03:** Given existing availability, when it is updated or deleted, then subsequent schedule generation uses the new definition.
- **FR-03-AC04:** Given an end time not later than the start time, when availability is submitted, then it is rejected with an error.

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
- **FR-06-AC04:** Given a completed session, then its duration is removed from the task’s remaining workload; delayed or missed work remains outstanding.

### FR-07 — Adaptive estimates

- **FR-07-AC01:** Given completed sessions with estimated and actual durations, when a later estimate is generated, then only records created before that task are used.
- **FR-07-AC02:** Given a history where actual durations consistently exceed estimates, then the adaptive estimate is greater than the equivalent unadjusted estimate.
- **FR-07-AC03:** Given a history where actual durations consistently fall below estimates, then the adaptive estimate is lower than the equivalent unadjusted estimate.
- **FR-07-AC04:** Given no usable history, then the original student estimate is retained or a documented default is applied.
- **FR-07-AC05:** Repeating estimation with identical inputs and history produces the same result.

### FR-08 — Overload detection

- **FR-08-AC01:** Given required workload greater than available time before applicable deadlines, when scheduling runs, then the workload is identified as infeasible.
- **FR-08-AC02:** The warning states the affected task or period, required time, available time, and calculated shortfall.
- **FR-08-AC03:** An infeasible workload produces a warning instead of a schedule that violates hard constraints.
- **FR-08-AC04:** Given workload equal to or below available capacity, then no overload warning is displayed.

### FR-09 — Automatic rescheduling

- **FR-09-AC01:** Given a missed session with future availability, when rescheduling runs, then its remaining workload is moved to a valid future slot.
- **FR-09-AC02:** Given a changed deadline, duration, priority, or availability period, then affected future sessions are recalculated.
- **FR-09-AC03:** Completed sessions are not moved or duplicated during rescheduling.
- **FR-09-AC04:** Rescheduled sessions contain no hard conflicts and do not exceed their task deadlines when a feasible solution exists.
- **FR-09-AC05:** Under limited capacity, urgency and priority determine which outstanding work is placed first.
- **FR-09-AC06:** If no feasible reschedule exists, then an overload explanation is shown instead of an invalid plan.

### FR-10 — Progress and comparison

- **FR-10-AC01:** Given tasks with planned sessions, then progress displays completed workload relative to total workload.
- **FR-10-AC02:** Given completed sessions with actual durations, then estimated duration, actual duration, and their numeric difference are displayed.
- **FR-10-AC03:** Progress and comparisons update after a session outcome or actual duration changes.
- **FR-10-AC04:** Sessions without actual duration are shown as pending or unavailable and are not treated as zero-duration completions.

## Non-functional acceptance criteria

### NFR-01 — Security

- **NFR-01-AC01:** Given users A and B, when A requests B’s tasks, sessions, availability, progress, or account records through any API operation, then the request returns 403 or 404 and no data is disclosed or changed.
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

- **NFR-04-AC01:** At least 80% of representative participants independently complete: sign in, create a task, define availability, generate a schedule, and record a completed session.
- **NFR-04-AC02:** No verbal, written, or operator assistance is provided after the workflow begins.
- **NFR-04-AC03:** Successes, failures, participant characteristics, and observed usability issues are recorded in the test report.

### NFR-05 — Compatibility

- **NFR-05-AC01:** At viewport widths of 360, 768, and 1440 pixels, all main pages remain readable and operable without unintended horizontal scrolling, overlap, or clipped controls.
- **NFR-05-AC02:** The main task-to-schedule workflow completes successfully in current Chrome, Edge, and Safari.
- **NFR-05-AC03:** Keyboard entry, forms, navigation, and status feedback remain functional in each tested browser.
- **NFR-05-AC04:** Browser names, versions, operating systems, and viewport sizes are recorded as test evidence.

### NFR-06 — Privacy

- **NFR-06-AC01:** Every collected personal field appears in an approved data inventory with a documented planning purpose; no unlisted field is collected.
- **NFR-06-AC02:** A student can view and update each editable record they own, and changes persist.
- **NFR-06-AC03:** A student can delete their tasks, availability, sessions, and associated planning records.
- **NFR-06-AC04:** After deletion, removed records are inaccessible through the interface and API and are excluded from scheduling and estimation.
- **NFR-06-AC05:** Deleting or updating one student’s records does not affect another student’s records.