/**
 * Wire shapes exactly as FastAPI serialises them (snake_case).
 *
 * These mirror the Pydantic response models in
 * `backend/src/studyflow/api/*.py`. Keep them in sync with that source of
 * truth; the mappers in `./mappers.ts` translate them into the camelCase
 * domain types under `@/types`.
 */

// ─── Enums (backend/src/studyflow/tasks/service.py) ──────────────
export type WireTaskCategory =
  | "assignment"
  | "reading"
  | "exam_preparation"
  | "project"
  | "research_writing"
  | "other";

export type WireTaskPriority = "low" | "medium" | "high";

export type WireTaskStatus = "not_started" | "in_progress" | "completed" | "overdue";

// ─── Authentication (api/auth.py) ────────────────────────────────
export interface WireAuthenticatedAccount {
  id: string;
  email: string;
  name: string;
}

export interface WireLoginResponse {
  account: WireAuthenticatedAccount;
  csrf_token: string;
}

export interface WireCurrentSessionResponse {
  account: WireAuthenticatedAccount;
}

export interface WireAuthenticationMessage {
  message: string;
}

export interface WireEmailVerificationResponse {
  signup_token: string;
}

export interface WireOIDCStartResponse {
  authorization_url: string;
}

// ─── Account (api/account.py) ────────────────────────────────────
export interface WireAccountProfile {
  id: string;
  email: string;
  name: string;
}

export interface WireStudyPreferences {
  timezone: string;
  preferred_session_length_minutes: number;
  minimum_break_minutes: number;
  availability_confirmation_required: boolean;
}

export interface WireLinkedIdentity {
  provider: string;
  email: string;
  linked_at: string;
}

// ─── Academic tasks (api/tasks.py) ───────────────────────────────
export interface WireAcademicTask {
  id: string;
  title: string;
  category: WireTaskCategory;
  priority: WireTaskPriority;
  course: string | null;
  notes: string | null;
  deadline_at: string;
  original_estimate_minutes: number;
  planned_duration_minutes: number;
  created_at: string;
  updated_at: string;
  status: WireTaskStatus;
}

export interface WireAcademicTaskRequest {
  title: string;
  category: WireTaskCategory;
  priority: WireTaskPriority;
  course: string | null;
  notes: string | null;
  deadline_at: string;
  original_estimate_minutes: number;
}

// ─── Availability (api/availability.py) ──────────────────────────
export interface WireAvailabilityWindow {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
}

export interface WireAvailabilityWindowRequest {
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface WireUnavailablePeriod {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface WireUnavailablePeriodChange {
  period: WireUnavailablePeriod;
  invalidated_future_session_ids: string[];
}

// ─── Study sessions and scheduling ──────────────────────────────
// `backend/src/studyflow/api/study_sessions.py` and
// `backend/src/studyflow/api/schedule_proposals.py`.

export type WireSessionOutcomeKind = "completed" | "delayed" | "missed";

export interface WireSessionOutcome {
  session_id: string;
  kind: WireSessionOutcomeKind;
  actual_minutes: number;
  remaining_minutes: number;
  recorded_at: string;
  rescheduled_at: string | null;
}

/**
 * An accepted session. Note there is no `task_title` here — unlike the
 * proposal's session shape — so callers join titles from the task list.
 */
export interface WireStudySession {
  id: string;
  task_id: string;
  starts_at: string;
  ends_at: string;
  planned_duration_minutes: number;
  outcome: WireSessionOutcome | null;
}

export interface WireProposedSession {
  id: string;
  task_id: string;
  task_title: string | null;
  starts_at: string;
  ends_at: string;
  planned_duration_minutes: number;
}

export interface WireTaskAllocation {
  task_id: string;
  task_title: string | null;
  deadline_at: string;
  required_minutes: number;
  scheduled_minutes: number;
  unscheduled_minutes: number;
  raw_calendar_capacity_minutes: number;
  available_minutes_before_deadline: number;
  shortfall_minutes: number;
}

export interface WireUnscheduledWork {
  task_id: string;
  task_title: string | null;
  required_minutes: number;
  available_minutes_before_deadline: number;
  shortfall_minutes: number;
  unscheduled_minutes: number;
}

export interface WireRelevantUnavailablePeriod {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface WireOverloadWarning {
  affected_tasks: WireUnscheduledWork[];
  relevant_unavailable_periods: WireRelevantUnavailablePeriod[];
  remedies: ("extend_deadline" | "add_availability")[];
}

export interface WireScheduleProposal {
  id: string;
  kind: "generation" | "revision";
  revision_reason: string | null;
  status: "feasible" | "overload";
  created_at: string;
  sessions: WireProposedSession[];
  task_allocations: WireTaskAllocation[];
  unscheduled_work: WireUnscheduledWork[];
  overload_warning: WireOverloadWarning | null;
  scenario: WireScheduleScenario | null;
}

export interface WireScheduleScenario {
  temporary_availability: {
    starts_at: string;
    ends_at: string;
  }[];
  temporary_blocked_periods: {
    starts_at: string;
    ends_at: string;
    reason: string | null;
  }[];
  deadline_overrides: {
    task_id: string;
    deadline_at: string;
  }[];
}

export interface WireScheduleSimulation {
  proposal: WireScheduleProposal;
  active_schedule_changed: false;
  requires_user_review: false;
  persisted: false;
}

export interface WireAcceptedSchedule {
  sessions: WireProposedSession[];
}

export interface WireMissedSessionRecovery {
  session: WireStudySession;
  outcome: WireSessionOutcome;
  revision: WireScheduleProposal;
}
