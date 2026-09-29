import type {
  AcademicTask,
  AvailabilityWindow,
  Category,
  Priority,
  SessionOutcome,
  StudySession,
  TaskStatus,
  UnavailablePeriod,
} from "@studyflow/domain";

export type WireTaskCategory =
  | "assignment"
  | "reading"
  | "exam_preparation"
  | "project"
  | "research_writing"
  | "other";
export type WireTaskPriority = "low" | "medium" | "high";
export type WireTaskStatus = "not_started" | "in_progress" | "completed" | "overdue";
export type WirePlannedSource = "original" | "adaptive";

export interface WireAcademicTask {
  id: string;
  title: string;
  category: WireTaskCategory;
  priority: WireTaskPriority;
  course: string | null;
  notes: string | null;
  deadline_at: string;
  original_estimate_minutes: number;
  adaptive_estimate_minutes: number | null;
  planned_source: WirePlannedSource;
  planned_duration_minutes: number;
  estimate_frozen?: boolean;
  status: WireTaskStatus;
  created_at: string;
  updated_at: string;
}

export interface WireStudySession {
  id: string;
  task_id: string;
  starts_at: string;
  ends_at: string;
  planned_duration_minutes: number;
  outcome: WireSessionOutcome | null;
}

export type WireSessionOutcomeKind = "completed" | "delayed" | "missed";

export interface WireSessionOutcome {
  session_id: string;
  kind: WireSessionOutcomeKind;
  actual_minutes: number;
  remaining_minutes: number;
  recorded_at: string;
  rescheduled_at: string | null;
}

export interface WireProposedSession {
  id: string;
  task_id: string;
  task_title: string | null;
  starts_at: string;
  ends_at: string;
  planned_duration_minutes: number;
}

export interface WireUnscheduledWork {
  task_id: string;
  task_title: string | null;
  required_minutes: number;
  available_minutes_before_deadline: number;
  shortfall_minutes: number;
  unscheduled_minutes: number;
}

export interface WireScheduleProposal {
  id: string;
  kind: "generation" | "revision";
  revision_reason: string | null;
  status: "feasible" | "overload";
  created_at: string;
  sessions: WireProposedSession[];
  task_allocations: unknown[];
  unscheduled_work: WireUnscheduledWork[];
  overload_warning: unknown | null;
  scenario: unknown | null;
}

export interface WireEffortProgress {
  task_id: string;
  task_title: string;
  actual_duration_minutes: number;
  estimated_remaining_minutes: number;
  effort_percent: number;
  sessions_completed: number;
  sessions_upcoming: number;
  status: WireTaskStatus;
}

export interface WireAvailabilityWindow {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
}

export interface WireUnavailablePeriod {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface WireCurrentSessionResponse {
  account: { id: string; email: string; name: string; avatar_url?: string };
}

export interface WireMobileTokenResponse {
  account: { id: string; email: string; name: string; avatar_url?: string | null };
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: "Bearer";
}

export interface WireAccountProfile {
  id: string;
  email: string;
  name: string;
  password_set: boolean;
  avatar_url: string | null;
}

export interface WireStudyPreferences {
  timezone: string;
  preferred_session_length_minutes: number;
  minimum_break_minutes: number;
  availability_confirmation_required: boolean;
}

export interface WireGoogleImportStatus {
  configured: boolean;
  calendar_checked_at: string | null;
  classroom_checked_at: string | null;
}

export interface WireCalendarImportItem {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: "new" | "changed" | "unchanged";
}

export interface WireClassroomImportItem {
  id: string;
  title: string;
  course: string | null;
  due_at: string;
  link: string | null;
  suggested_category: WireTaskCategory;
  status: "new" | "already_imported";
}

export interface WireCalendarImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped_past: number;
}

export interface WireClassroomImportResult {
  created_task_ids: string[];
  already_imported: string[];
  failed: Array<{ id: string; reason: "deadline_passed" | "invalid" }>;
}

export type WireGoogleImportPreview =
  | {
      id: string;
      source: "google_calendar";
      expires_at: string;
      items: WireCalendarImportItem[];
    }
  | {
      id: string;
      source: "google_classroom";
      expires_at: string;
      items: WireClassroomImportItem[];
    };

export interface ApiTransport {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

export const queryKeys = {
  session: ["studyflow", "session"] as const,
  tasks: ["studyflow", "tasks"] as const,
  task: (id: string) => ["studyflow", "task", id] as const,
  taskSearch: (query: string) => ["studyflow", "tasks", "search", query] as const,
  availability: ["studyflow", "availability"] as const,
  schedule: ["studyflow", "schedule", "active"] as const,
  pendingRevision: ["studyflow", "schedule", "pending-revision"] as const,
  progress: ["studyflow", "progress"] as const,
  account: ["studyflow", "account"] as const,
  profile: ["studyflow", "account", "profile"] as const,
  preferences: ["studyflow", "account", "preferences"] as const,
  googleImportStatus: ["studyflow", "google-import", "status"] as const,
  unavailablePeriods: ["studyflow", "availability", "unavailable-periods"] as const,
} as const;

export type {
  AcademicTask,
  AvailabilityWindow,
  Category,
  Priority,
  SessionOutcome,
  StudySession,
  TaskStatus,
  UnavailablePeriod,
};
