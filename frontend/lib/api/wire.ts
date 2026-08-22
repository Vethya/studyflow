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
