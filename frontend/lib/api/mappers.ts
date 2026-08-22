/**
 * Translation between backend wire shapes (snake_case, lowercase enums) and
 * the camelCase domain types the UI is written against.
 */

import type { AcademicTask, Category, Priority, TaskStatus } from "@/types/task";
import type { AvailabilityWindow, UnavailablePeriod } from "@/types/availability";
import type { StudentAccount } from "@/types/user";
import type {
  WireAcademicTask,
  WireAvailabilityWindow,
  WireLinkedIdentity,
  WireStudyPreferences,
  WireTaskCategory,
  WireTaskPriority,
  WireTaskStatus,
  WireUnavailablePeriod,
} from "./wire";

// ─── Enum mapping ────────────────────────────────────────────────
const CATEGORY_FROM_WIRE: Record<WireTaskCategory, Category> = {
  assignment: "Assignment",
  reading: "Reading",
  exam_preparation: "Exam Preparation",
  project: "Project",
  research_writing: "Research/Writing",
  other: "Other",
};

const CATEGORY_TO_WIRE: Record<Category, WireTaskCategory> = {
  Assignment: "assignment",
  Reading: "reading",
  "Exam Preparation": "exam_preparation",
  Project: "project",
  "Research/Writing": "research_writing",
  Other: "other",
};

const PRIORITY_FROM_WIRE: Record<WireTaskPriority, Priority> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const PRIORITY_TO_WIRE: Record<Priority, WireTaskPriority> = {
  Low: "low",
  Medium: "medium",
  High: "high",
};

const STATUS_FROM_WIRE: Record<WireTaskStatus, TaskStatus> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
};

const STATUS_TO_WIRE: Record<TaskStatus, WireTaskStatus> = {
  "Not Started": "not_started",
  "In Progress": "in_progress",
  Completed: "completed",
  Overdue: "overdue",
};

export const toWireCategory = (value: Category): WireTaskCategory => CATEGORY_TO_WIRE[value];
export const toWirePriority = (value: Priority): WireTaskPriority => PRIORITY_TO_WIRE[value];
export const toWireStatus = (value: TaskStatus): WireTaskStatus => STATUS_TO_WIRE[value];

// ─── Tasks ───────────────────────────────────────────────────────
/**
 * The task endpoints do not yet report logged effort or session counts —
 * those arrive with the scheduling API, which is not implemented on the
 * backend. Until then they read as zero rather than as mock values, so the
 * UI never shows a number the server did not produce.
 */
export function toAcademicTask(wire: WireAcademicTask): AcademicTask {
  return {
    id: wire.id,
    title: wire.title,
    category: CATEGORY_FROM_WIRE[wire.category],
    priority: PRIORITY_FROM_WIRE[wire.priority],
    status: STATUS_FROM_WIRE[wire.status],
    deadline: wire.deadline_at,
    originalEstimate: wire.original_estimate_minutes,
    plannedDuration: wire.planned_duration_minutes,
    actualDuration: 0,
    remainingDuration: wire.planned_duration_minutes,
    sessionsCompleted: 0,
    sessionsUpcoming: 0,
    course: wire.course ?? undefined,
    notes: wire.notes ?? undefined,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

// ─── Availability windows ────────────────────────────────────────
/**
 * The backend indexes weekdays the way Python's `datetime.weekday()` does —
 * 0 = Monday through 6 = Sunday — while the UI type uses 0 = Sunday.
 * Both conversions live here so the offset exists in exactly one place.
 */
export const wireWeekdayToDayOfWeek = (weekday: number): number => (weekday + 1) % 7;
export const dayOfWeekToWireWeekday = (dayOfWeek: number): number => (dayOfWeek + 6) % 7;

/** FastAPI serialises `datetime.time` as `HH:MM:SS`; the UI wants `HH:mm`. */
const trimSeconds = (value: string): string => value.slice(0, 5);

export function toAvailabilityWindow(wire: WireAvailabilityWindow): AvailabilityWindow {
  return {
    id: wire.id,
    dayOfWeek: wireWeekdayToDayOfWeek(wire.weekday),
    startTime: trimSeconds(wire.start_time),
    endTime: trimSeconds(wire.end_time),
  };
}

// ─── Unavailable periods ─────────────────────────────────────────
/**
 * The backend stores a single free-text `reason`; the UI shows a `title` and
 * an optional longer `reason`. The reason doubles as the title so nothing is
 * invented client-side.
 */
export function toUnavailablePeriod(wire: WireUnavailablePeriod): UnavailablePeriod {
  return {
    id: wire.id,
    title: wire.reason ?? "Unavailable",
    startDate: wire.starts_at,
    endDate: wire.ends_at,
    reason: wire.reason ?? undefined,
  };
}

// ─── Account ─────────────────────────────────────────────────────
/**
 * `StudentAccount` is assembled from three endpoints: the profile, the study
 * preferences, and the linked-identity list.
 */
export function toStudentAccount(
  profile: { id: string; email: string; name: string },
  preferences: WireStudyPreferences,
  identities: WireLinkedIdentity[],
): StudentAccount {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    // Reaching an authenticated endpoint at all implies a verified address:
    // registration cannot complete without following the emailed link.
    isEmailVerified: true,
    hasGoogleLinked: identities.some((identity) => identity.provider === "google"),
    timezone: preferences.timezone,
    preferredSessionLength: preferences.preferred_session_length_minutes,
    minimumBreak: preferences.minimum_break_minutes,
  };
}
