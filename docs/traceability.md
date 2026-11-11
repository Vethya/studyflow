# SPEC Traceability: Isolation and Evaluation Gap

| Requirement | Implementation | Verification |
| --- | --- | --- |
| §4.2 / §18.3 ownership | Existing repositories remain account-scoped; HTTP matrix exercises every student-owned resource | `backend/tests/test_cross_user_isolation.py` |
| NFR-01-AC01–AC04 | Two authenticated principals cannot read or mutate each other’s tasks, availability, sessions, proposals, progress, or account records | `backend/tests/test_cross_user_isolation.py` |
| §16.1–§16.2 evaluation records | Export joins persisted adaptive predictions to account-scoped session outcomes; pending actuals remain `null` | `backend/src/studyflow/cli/export_evaluation.py` |
| §16.3 metrics | Export calculates per-participant sample count, MAE, signed bias, and MAE reduction through the shared comparison metric implementation | `backend/src/studyflow/evaluation/comparison.py` |
| §24.1 evaluation resources | Repeatable seed creates five pseudonymous participants with tasks, schedules, outcomes, predictions, and pending records | `backend/benchmarks/seed_evaluation.py` |
| §24.3–§24.4 export | JSON/CSV export is deterministic except for `exported_at` and excludes direct PII/raw UUIDs | `backend/tests/test_evaluation_export.py` |
| §27 completion | Dedicated isolation and export tests provide the missing automated evidence | Focused backend test commands above |

# SPEC §22 Requirements Traceability Matrix

Status: 2026-09-15. Each row links the implementation, automated evidence, and
manual or evaluation evidence where the requirement needs it (SPEC §22). Paths
are relative to the repository root.

| Requirement | Implementation | Automated evidence | Manual / evaluation evidence |
| --- | --- | --- | --- |
| **FR-01** Account (§6, §17.7) | `backend/src/studyflow/auth/`, `backend/src/studyflow/accounts/`, `backend/src/studyflow/api/auth.py`, `backend/src/studyflow/api/account.py`; `frontend/app/(auth)/`, `frontend/app/(app)/settings/page.tsx`, `frontend/lib/api/auth.ts` | `test_registration_*`, `test_email_verification_api`, `test_login_*`, `test_password_recovery*`, `test_password_security`, `test_breached_passwords`, `test_google_oidc*`, `test_session_*`, `test_cookie_policy`, `test_account_*` | NFR-05 login keyboard check (`frontend/e2e/nfr05.spec.ts`) |
| **FR-02** Academic tasks (§7, §17.4) | `backend/src/studyflow/tasks/`, `backend/src/studyflow/api/tasks.py`; `frontend/app/(app)/tasks/`, `frontend/components/task-form-dialog.tsx` | `test_academic_task_*`, `test_task_deletion_recalculation`; `frontend/components/task-form-dialog.test.tsx` | — |
| **FR-03** Availability (§8, §17.5) | `backend/src/studyflow/availability/`, `backend/src/studyflow/api/availability.py`; `frontend/app/(app)/availability/page.tsx` | `test_availability_*`, `test_unavailable_periods*`, `test_study_time_updates`, `test_timezones` | — |
| **FR-04** Task splitting (§9) | `backend/src/studyflow/scheduling/splitting.py` | `test_scheduling_splitting` | — |
| **FR-05** Scheduling and proposal control (§10, §11) | `backend/src/studyflow/scheduling/` (`kernel.py`, `_solver.py`, `service.py`, `proposals.py`, `acceptance.py`), `backend/src/studyflow/api/schedule_proposals.py`; `frontend/components/schedule-preview.tsx`, `frontend/app/(app)/calendar/page.tsx` | `test_scheduling_kernel`, `test_scheduling_time_policy`, `test_scheduling_calendar`, `test_scheduling_uniform_flow`, `test_schedule_generation_service`, `test_schedule_proposal_*`, `test_schedule_acceptance`, `test_schedule_workflow`; NFR-05 task-to-schedule workflow | — |
| **FR-06** Outcomes, actual duration, Effort Progress (§12, §13, §17.6) | `backend/src/studyflow/scheduling/outcomes.py`, `backend/src/studyflow/progress.py`, `backend/src/studyflow/api/study_sessions.py`, `backend/src/studyflow/api/progress.py`; `frontend/components/record-outcome-dialog.tsx`, `frontend/lib/api/progress.ts`, `frontend/app/(app)/progress/page.tsx` | `test_study_session_outcomes`, `test_progress`, `test_progress_api`; `frontend/lib/api/outcome-contract.test.ts`, `frontend/lib/api/progress.test.ts`, `frontend/lib/outcome-ui.test.ts` | Usability workflow step 4–5 (§24.2) |
| **FR-07** Qualified personal correction (§15, §16) | `backend/src/studyflow/estimation/`, `backend/src/studyflow/api/adaptive_estimates.py`; `frontend/components/adaptive-estimate.tsx`, `frontend/lib/api/adaptive-contract.ts` | `test_adaptive_estimation`, `test_adaptive_estimation_repository`, `test_adaptive_estimate_api`, `test_task_deletion_recalculation`, `test_evaluation_comparison`; `frontend/lib/api/adaptive-contract.test.ts` | Static-vs-adaptive comparison (`backend/benchmarks/compare_static_adaptive.py`, `docs/evaluation.md`) |
| **FR-08** Overload detection and explanation (§10.4, §10.5) | `backend/src/studyflow/scheduling/overload.py`, `backend/src/studyflow/api/schedule_proposals.py`; `frontend/components/overload-warning-list.tsx`, `frontend/components/shortfall-card.tsx` | `test_scheduling_overload`, `test_schedule_proposal_api`; `frontend/lib/api/overload-mapping.test.ts` | — |
| **FR-09** Delayed/Missed revision (§14) | `backend/src/studyflow/scheduling/recovery.py`, `backend/src/studyflow/scheduling/recovery_repositories.py`; `frontend/lib/outcome-ui.ts`, `frontend/components/schedule-preview.tsx` | `test_schedule_recovery`, `test_missed_session_recovery_workflow`; `frontend/lib/api/scheduling.outcome.test.ts` | — |
| **NFR-01** Security (§19.1) | Account-scoped repositories, `backend/src/studyflow/auth/session_authentication.py`, CSRF in `backend/src/studyflow/api/account.py`; `frontend/lib/api/client.ts` | `test_cross_user_isolation`, `test_session_authentication`, `test_cookie_policy`, `test_registration_rate_limit`, `test_cors` | — |
| **NFR-02** Performance (§19.2) | `backend/benchmarks/seed_nfr02.py`, `backend/benchmarks/http_performance.py`, `backend/benchmarks/scheduler_performance.py` | `test_scheduling_performance`, `test_nfr02_benchmark` | `docs/evidence/nfr02-performance-2026-09-14.md` |
| **NFR-03** Reliability (§19.3) | CP-SAT hard constraints and technical-failure handling in `backend/src/studyflow/scheduling/` | `test_scheduling_kernel`, `test_scheduling_overload`, `test_schedule_recovery`, `test_missed_session_recovery_workflow` | — |
| **NFR-04** Usability (§19.4, §24.1–§24.3) | Main workflow pages under `frontend/app/(app)/` | — | External usability study with at least 5 students (not yet recorded) |
| **NFR-05** Compatibility and accessibility (§19.5) | Responsive layouts and accessible controls in `frontend/` | `frontend/e2e/nfr05.spec.ts` (Chrome, Edge, WebKit, mobile emulation; axe checks); CI smoke test in `.github/workflows/frontend-ci.yml` | `docs/nfr05-mobile-safari-checklist.md` (real iPhone Safari) |
| **NFR-06** Privacy (§18, §19.6) | Account-scoped deletion in task and availability repositories; `backend/src/studyflow/cli/export_evaluation.py` | `test_cross_user_isolation`, `test_academic_task_lifecycle_repository`, `test_unavailable_periods_repository`, `test_task_deletion_recalculation`, `test_evaluation_export` | `docs/data-inventory.md` |

Backend test names refer to `backend/tests/<name>.py`; a trailing `*` covers
every file with that prefix.
