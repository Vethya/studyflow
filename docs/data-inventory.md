# StudyFlow data inventory

Status: 2026-09-18

This inventory is the NFR-06 evidence required by [SPEC §19.6](../SPEC.md#196-privacy).
It covers data that StudyFlow stores, processes transiently, or emits through the
documented evaluation export. It was checked against the SQLAlchemy models in
[`backend/src/studyflow/database/models`](../backend/src/studyflow/database/models)
and the authentication request flow.

## Collection rules

StudyFlow collects data only for authentication, planning, security, and thesis
evaluation. Course and notes are optional user-entered planning text. The
application does not require confidential academic content.

Raw passwords, one-time tokens, session tokens, CSRF tokens, and Google
authorization codes are processed only to complete an authentication operation.
The server stores password and token hashes where persistence is required. Raw
values are not written to the database or included in the evaluation export.

StudyFlow does not store raw request IP addresses, user-agent telemetry, an
in-app survey, consent responses, or an admin audit log. The configured email
provider receives authentication email addresses and one-time links as needed
to deliver verification and recovery messages. External provider retention is
outside this repository and must follow the selected provider's policy.

## Persisted data

Retention wording such as "account lifetime" means until the student deletes
their account. Self-service account deletion was added after SPEC §3.2 and §18
excluded it (PR #22); it deletes the account row, and every account-owned table
cascades. "Owner deletion" means deletion through the supported record operation,
with the ownership checks described in [SPEC §18](../SPEC.md#18-privacy-and-deletion).

| Store and fields | Classification | Purpose | Retention need | Deletion or expiry behavior |
| --- | --- | --- | --- | --- |
| `student_accounts`: `id`, `email`, `name`, `password_hash`, `email_verified_at`, `timezone`, `availability_timezone_confirmed`, `preferred_session_length_minutes`, `minimum_break_minutes`, `created_at`, `updated_at` | Direct identity, credential material, and planning preferences | Authenticate the student, show the account profile, interpret availability, and configure scheduling | Identity and preferences are needed for the account lifetime. The password hash is needed while password authentication is enabled. | Name and preferences can be updated. Password changes replace the old hash and revoke active sessions. Self-service account deletion from Settings, after password or Google re-authentication, deletes the row and cascades to every account-owned table below. |
| `authentication_identities`: `id`, `account_id`, `provider`, `subject`, `email`, `created_at` | Direct identity and external-auth identifier | Authenticate and link the student's Google identity | Account lifetime, while the identity remains linked | Cascades from account deletion. |
| `authentication_sessions`: `id`, `account_id`, `token_hash`, `csrf_token_hash`, `created_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at` | Security data; token hashes are not usable as raw tokens | Maintain server-managed login sessions and CSRF protection | Only while the session is active, up to the idle or absolute expiry | Sign-out and password reset revoke sessions. Expired sessions are rejected and expired rows are cleaned during session creation. |
| `authentication_email_tokens`: `id`, `account_id`, `purpose`, `token_hash`, `created_at`, `expires_at`, `consumed_at` | Security data linked to an account | Verify email addresses and reset passwords | Only until consumption or expiry | Tokens are one-time, rejected after expiry, and replaced when a new reset token is issued. A consumed reset token is marked with `consumed_at`. |
| `authentication_registrations`: `id`, `email`, `verification_token_hash`, `verification_expires_at`, `signup_token_hash`, `signup_expires_at`, `verified_at`, `created_at`, `updated_at` | Direct identity and temporary security data for an uncompleted registration | Complete email verification before creating or updating an account | Until registration completes or its verification/sign-up window expires | The row is deleted when registration completes. A new registration rotates the pending hashes and expiry values. Expired values cannot complete registration. |
| `authentication_rate_limits`: `id`, `action`, `key_hash`, `window_started_at`, `attempts`, `updated_at` | Security data; `key_hash` is a one-way key derived from rate-limit inputs such as client IP or email | Limit authentication, verification, recovery, and OIDC abuse | Only for the active rate-limit window | Expired windows and completed in-flight reservations are deleted by the rate-limit service. Raw rate-limit inputs are not stored. |
| `authentication_oidc_states`: `id`, `state_hash`, `nonce_hash`, `timezone`, `created_at`, `expires_at`, `consumed_at` | Temporary security data and a planning timezone | Bind a Google sign-in callback to the initiating browser and preserve its timezone | Only for the short OIDC transaction window | State is consumed after callback validation, rejected after expiry, and expired state rows are cleaned when new state is stored. |
| `authentication_account_deletion_challenges`: `id`, `account_id`, `token_hash`, `created_at`, `expires_at`, `consumed_at` | Security data linked to an account | Prove recent re-authentication before permanent account deletion | Only for the ten-minute deletion window | One-time and expiring. Cascades when the account is deleted. |
| `authentication_oidc_link_challenges`: `id`, `account_id`, `subject`, `email`, `token_hash`, `created_at`, `expires_at`, `consumed_at` | Direct identity and temporary security data | Require password confirmation before linking Google to an existing account | Only for the short account-linking window | A challenge is one-time, expires, and is marked consumed after successful linking. A new challenge replaces outstanding unconsumed challenges for that account. |
| `academic_tasks`: `id`, `account_id`, `title`, `category`, `priority`, `course`, `notes`, `deadline_at`, `original_estimate_minutes`, `adaptive_estimate_minutes`, `planned_source`, `planned_duration_minutes`, `estimate_frozen_at`, `overdue_remediated_deadline_at`, `completed_at`, `finished_early_at`, `external_source`, `external_id`, `created_at`, `updated_at` | Student-entered planning data and behavior-derived estimates | Build schedules, track task lifecycle, and calculate remaining work and adaptive estimates | Until the student deletes the task or the account is deleted | Owner-only deletion removes the task, its deadline history, sessions, outcomes, adaptive-estimation history, and related proposal/recovery records. Adaptive eligibility and metrics are recalculated without the deleted history. |
| `adaptive_estimation_predictions`: `task_id`, `account_id`, `category`, `original_minutes`, `predicted_minutes`, `correction_factor`, `history_scope`, `history_count`, `exposed`, `created_at` | Behavior-derived estimation and internal evaluation data | Capture the chronological prediction made when a task was created, so adaptive qualification compares Original and Adaptive on the same tasks (SPEC §15.2, §16). `history_count` and accuracy figures stay internal and are not shown to the student (SPEC §15.6). | While the task exists | Cascades from task or account deletion and is explicitly removed by the task repository. Deleting history recalculates adaptive eligibility and reconciles acknowledgments. |
| `adaptive_estimation_acknowledgments`: `account_id`, `category`, `correction_factor`, `acknowledged_at` | Student decision about planning behavior | Remember that the student acknowledged a large adjustment for a Category, so normal task creation is not repeatedly blocked (SPEC §15.4) | Until the factor changes materially, adaptive qualification is lost, or the account is deleted | Removed when qualification is lost or the Category's factor returns to 0.5–2.0 or drifts by at least 25%, including after task deletion. Cascades from account deletion. |
| `google_import_states`: `id`, `account_id`, `state_hash`, `source`, `code_verifier`, `horizon_days`, `created_at`, `expires_at`, `consumed_at` | Security data linked to an account | Bind a Google Calendar or Classroom consent redirect to the student who started it, and finish the PKCE code exchange | Only for the ten-minute OAuth window | Single-use. A new import start deletes the account's previous states and every expired or consumed state. Cascades from account deletion. |
| `google_import_checks`: `account_id`, `source`, `checked_at` | Technical usage data | Remember when the student last asked Google for calendar events or coursework, so StudyFlow can offer to check again | Until the account is deleted | One row per student and source, overwritten on each import. Holds no Google content. Cascades from account deletion. |
| `google_import_snapshots`: `id`, `account_id`, `source`, `items` (calendar: `id`, `title`, `starts_at`, `ends_at`, `all_day`; classroom: `id`, `title`, `course`, `due_at`, `link`, `suggested_category`), `created_at`, `expires_at`, `consumed_at` | Third-party planning data copied from Google, with user-authored titles | Show the student what can be imported before anything is created | At most 30 minutes, and only until the student confirms or discards it | Confirming marks it consumed; a later import deletes consumed, expired, and older snapshots. Discard deletes it immediately. Cascades from account deletion. |
| `task_deadline_history`: `id`, `task_id`, `previous_deadline_at`, `new_deadline_at`, `changed_at` | Planning history | Preserve deadline changes needed to explain and recalculate planning decisions | While the task exists | Cascades from task deletion and is explicitly removed by the task repository. |
| `availability_windows`: `id`, `account_id`, `weekday`, `local_start_time`, `local_end_time`, `crosses_midnight` | Planning preferences | Define recurring study capacity | Until the student replaces or removes the window, or the account is deleted | The student's complete recurring-window set is replaced as one owned collection. Changes can invalidate affected future sessions; unrelated accounts are not touched. |
| `unavailable_periods`: `id`, `account_id`, `starts_at`, `ends_at`, `reason`, `external_source`, `external_id` | Planning data, with optional user-entered text | Exclude exceptional times from scheduling | Until the student removes or updates the period, or the account is deleted | Owner-only deletion removes the period. Creating or updating a conflicting period invalidates affected future sessions and reports their IDs. |
| `schedule_proposals`: `id`, `account_id`, `kind`, `revision_reason`, `status`, `input_fingerprint`, `scenario` (`temporary_availability.starts_at`, `temporary_availability.ends_at`, `temporary_blocked_periods.starts_at`, `temporary_blocked_periods.ends_at`, `temporary_blocked_periods.reason`, `deadline_overrides.task_id`, `deadline_overrides.deadline_at`), `created_at` | Technical planning and evaluation data; `revision_reason` may contain user-provided workflow context | Store the current generated proposal or revision before acceptance and explain overload/revision decisions | Until the proposal is replaced or its owning task/recovery data is deleted | Replaced or invalidated proposals and their dependent allocations, sessions, and recovery snapshots are removed by the scheduling repositories. Task deletion removes related proposals. |
| `study_sessions`: `id`, `account_id`, `task_id`, `proposal_id`, `starts_at`, `ends_at`, `planned_duration_minutes`, `invalidated_at`, `invalidation_reason` | Planning data and technical schedule state | Display accepted schedules, enforce ownership, and identify invalidated work | Until the owning task or related proposal is deleted; invalidation metadata remains while the record is needed for planning | Task deletion removes associated sessions. Availability or deadline changes invalidate affected future sessions. Proposal-owned sessions are removed when that proposal is invalidated. |
| `study_session_outcomes`: `session_id`, `kind`, `actual_minutes`, `remaining_minutes`, `recorded_at`, `rescheduled_at` | Behavior data supplied by the student | Update effort progress, derive remaining work, trigger recovery, and evaluate estimates | Until the owning session/task is deleted and for the period needed to calculate the thesis metrics | Deleting the owning task or session removes the outcome. Delayed or missed outcomes can create a revision, which is deleted with its proposal. |
| `schedule_recovery_snapshots`: `proposal_id`, `account_id`, `missed_session_id`, `captured_at` | Technical planning and behavior-recovery data | Preserve the inputs used to propose recovery after delayed or missed work | Only while the recovery proposal exists | Cascades with the recovery proposal or its triggering outcome. |
| `recovery_task_work`: `proposal_id`, `task_id`, `unfinished_minutes` | Technical planning data derived from outcomes | Record unfinished work used to build a recovery proposal | Only while the recovery proposal exists | Cascades with the recovery proposal or owning task. |
| `recovery_snapshot_outcomes`: `proposal_id`, `session_id` | Technical relationship data | Link a recovery proposal to the outcomes it used | Only while the recovery proposal exists | Cascades with the recovery proposal or linked outcome. |
| `proposal_task_allocations`: `proposal_id`, `task_id`, `deadline_at`, `required_minutes`, `scheduled_minutes`, `unscheduled_minutes`, `raw_calendar_capacity_minutes`, `available_minutes_before_deadline`, `shortfall_minutes` | Technical planning and evaluation data | Explain capacity, overload, shortfall, and schedule feasibility | Only while the proposal exists | Cascades with the proposal or owning task. |

The UUIDs and foreign keys in the planning stores are technical identifiers, not
student-facing content. They are still included here because they link records
to a student and control ownership and deletion cascades.

## Transient and derived data

| Data | Classification | Purpose | Retention need | Deletion or expiry behavior |
| --- | --- | --- | --- | --- |
| Registration email, login email, verification/resend email, password-reset email | Direct identity | Find the account or deliver an authentication message | Request or delivery duration only, except for the persisted email fields listed above | Canonicalized before use. The persisted registration/account email is covered above. The application code does not persist raw request bodies. |
| Raw passwords and new passwords | Credential material | Create, authenticate, or change a password | Request processing only | Hashed with Argon2id before persistence. Raw passwords are not stored or exported. |
| Raw verification tokens, reset tokens, signup tokens, OIDC state/challenge values, CSRF tokens, session tokens, and Google authorization codes | Security data | Complete one authentication transaction | Until the request/callback completes or the corresponding cookie expires | Raw values are held only by the browser or request path. The database stores hashes or consumed/expiry metadata where needed. |
| Client IP address used by authentication rate limits | Technical/security data | Apply abuse controls | Request processing only | Only a one-way `key_hash` is persisted for the rate-limit window. Raw IP is not stored by StudyFlow. |
| Authentication cookies `studyflow_session`, `studyflow_csrf`, `studyflow_oidc_state`, and `studyflow_oidc_link` | Security data | Carry server-session, CSRF, or OIDC transaction values between requests | The session cookie lasts up to seven days; OIDC cookies last up to ten minutes | Cleared on sign-out, callback completion/error, or expiry. |
| Google import authorization codes, access tokens, and granted scopes | Security data | Read Google Calendar events or Google Classroom coursework once, inside the import callback | Request processing only | No refresh token is requested. The access token is held in memory for the callback, sent only to Google, never logged or stored, and expires at Google within an hour. |
| Google Calendar and Classroom API responses | Third-party planning data | Reduce Google's data to the snapshot fields above | Request processing only | Only the snapshot fields are stored. `external_id` is a SHA-256 of the Google item identifiers, so Google IDs are not stored. |
| OIDC provider claims used by the app: Google subject, verified email, and display name | Direct identity | Authenticate a Google account or create a linked identity | Request processing, then the subject/email/name fields are persisted as described above | Raw provider responses are not stored as separate records. |
| Evaluation export fields: pseudonymous `participant_code`, `task_code`, `proposal_code`, and `session_code`; timezone and preferences; task categories, priorities, estimates, planning dates, completion dates; proposal status/reason; allocation totals; session timing; outcome kind, actual minutes, remaining minutes, and timestamps | Pseudonymized planning, behavior, and technical evaluation data | Produce consented thesis metrics without exposing email, name, password, task title, course, or notes | Retain only for the approved thesis analysis period, then delete the export files and copies | Generated by [`export_evaluation.py`](../backend/src/studyflow/cli/export_evaluation.py); not stored as a separate application table. Pseudonymous codes remain linkable within an export and are therefore treated as personal data for retention. |

StudyFlow does not collect the external usability-study consent, SUS responses,
ratings, comments, or observer notes. Those records belong in the external
evaluation tool and need a separate retention decision.

## Deletion and isolation evidence

The inventory is supported by the existing implementation and tests:

- [SPEC §18.2](../SPEC.md#182-user-controlled-record-deletion) defines task and associated-record deletion. [Task lifecycle tests](../backend/tests/test_academic_task_lifecycle_repository.py) cover owner checks and deletion.
- [Schedule recovery tests](../backend/tests/test_schedule_recovery.py) cover removal of proposals, snapshots, unfinished work, and linked outcomes when task data is deleted.
- [Availability tests](../backend/tests/test_unavailable_periods_repository.py) cover owner-only period updates and deletion.
- The resource API and repository tests cover account-scoped access for tasks, availability, sessions, proposals, outcomes, and progress. A query always receives the authenticated `account_id` and does not accept a caller-selected owner.
- [Evaluation export tests](../backend/tests/test_evaluation_export.py) verify that email, name, password hash, task title, and notes are excluded from the pseudonymized export.

NFR-06 claims only the student-owned planning and behavior deletion boundary
required by SPEC §18. Self-service account deletion (PR #22) goes beyond it but
is not yet part of the SPEC scope.
