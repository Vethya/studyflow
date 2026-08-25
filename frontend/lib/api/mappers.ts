/**
 * Translation between backend wire shapes (snake_case, lowercase enums) and
 * the camelCase domain types the UI is written against.
 */

import type { AcademicTask, Category, Priority, TaskStatus } from "@/types/task";
import type { AvailabilityWindow, UnavailablePeriod } from "@/types/availability";
import type { StudentAccount } from "@/types/user";
import type { SessionOutcome, StudySession } from "@/types/session";
import type { ScheduleProposal } from "@/types/schedule";
import type { EffortProgress, WeeklyProgress } from "@/types/progress";
import type {
  WireAcademicTask,
  WireAvailabilityWindow,
  WireLinkedIdentity,
  WireStudyPreferences,
  WireTaskCategory,
  WireTaskPriority,
  WireTaskStatus,
  WireUnavailablePeriod,
  WireStudySession,
  WireProposedSession,
  WireScheduleProposal,
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

// ─── Study sessions and scheduling ──────────────────────────────

/**
 * A session is "awaiting outcome" when it has finished but carries none
 * (SPEC §12.1). The API does not flag this; it is derived from the clock,
 * which is also how the app treats the work — still remaining, never
 * auto-marked Missed.
 */
export function toStudySession(
  wire: WireStudySession,
  titles?: Map<string, string>,
): StudySession {
  const kind = wire.outcome?.kind;
  const outcome: SessionOutcome | undefined =
    kind === "completed" ? "Completed"
    : kind === "delayed" ? "Delayed"
    : kind === "missed" ? "Missed"
    : undefined;

  return {
    id: wire.id,
    taskId: wire.task_id,
    taskTitle: titles?.get(wire.task_id) ?? "Untitled task",
    category: "Other",
    startTime: wire.starts_at,
    endTime: wire.ends_at,
    plannedDuration: wire.planned_duration_minutes,
    actualDuration: wire.outcome?.actual_minutes,
    outcome,
    isAwaitingOutcome: outcome === undefined && new Date(wire.ends_at) < new Date(),
  };
}

function toProposedSession(wire: WireProposedSession): StudySession {
  return {
    id: wire.id,
    taskId: wire.task_id,
    taskTitle: wire.task_title ?? "Untitled task",
    category: "Other",
    startTime: wire.starts_at,
    endTime: wire.ends_at,
    plannedDuration: wire.planned_duration_minutes,
    isAwaitingOutcome: false,
  };
}

export function toScheduleProposal(wire: WireScheduleProposal): ScheduleProposal {
  const periods = wire.overload_warning?.relevant_unavailable_periods ?? [];

  return {
    id: wire.id,
    // Only a revision carries a reason; a plain regeneration has none.
    reason:
      wire.kind === "revision"
        ? (wire.revision_reason ?? "Your plan needs updating.")
        : undefined,
    proposedSessions: wire.sessions.map(toProposedSession),
    unscheduledWork: wire.unscheduled_work.map((u) => ({
      taskId: u.task_id,
      taskTitle: u.task_title ?? "Untitled task",
      remainingMinutes: u.unscheduled_minutes,
      reason:
        u.available_minutes_before_deadline < u.required_minutes
          ? "There is not enough free study time before its deadline."
          : "It could not be placed in the time available.",
    })),
    // The overload explanation SPEC §10.5 requires is assembled from the
    // allocation figures, which carry every field it asks for.
    overloadWarnings: wire.task_allocations
      .filter((a) => a.shortfall_minutes > 0)
      .map((a) => ({
        taskId: a.task_id,
        taskTitle: a.task_title ?? "Untitled task",
        deadline: a.deadline_at,
        requiredMinutes: a.required_minutes,
        availableMinutes: a.available_minutes_before_deadline,
        shortfallMinutes: a.shortfall_minutes,
        relevantUnavailablePeriods: periods.map(
          (p) => p.reason ?? "an unavailable period",
        ),
      })),
    createdAt: wire.created_at,
  };
}

/** SPEC §13: effort = worked / (worked + estimated remaining). */
export function toEffortProgress(
  tasks: AcademicTask[],
  sessions: StudySession[],
): EffortProgress[] {
  const now = new Date();
  return tasks.map((task) => {
    const mine = sessions.filter((s) => s.taskId === task.id);
    const worked = mine.reduce((sum, s) => sum + (s.actualDuration ?? 0), 0);
    const remaining = task.remainingDuration;
    const denominator = worked + remaining;
    return {
      taskId: task.id,
      taskTitle: task.title,
      actualDuration: worked,
      estimatedRemaining: remaining,
      effortPercent: denominator > 0 ? Math.round((worked / denominator) * 100) : 0,
      sessionsCompleted: mine.filter((s) => s.outcome === "Completed").length,
      sessionsUpcoming: mine.filter((s) => !s.outcome && new Date(s.startTime) > now).length,
      status: task.status,
    };
  });
}

export function toWeeklyProgress(sessions: StudySession[]): WeeklyProgress {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  const end = new Date(start.getTime() + 7 * 86_400_000);

  const week = sessions.filter((s) => {
    const at = new Date(s.startTime);
    return at >= start && at < end;
  });

  return {
    weekStart: start.toISOString(),
    totalMinutesStudied: week.reduce((sum, s) => sum + (s.actualDuration ?? 0), 0),
    totalMinutesPlanned: week.reduce((sum, s) => sum + s.plannedDuration, 0),
    sessionsCompleted: week.filter((s) => s.outcome === "Completed").length,
    tasksCompleted: 0,
  };
}
