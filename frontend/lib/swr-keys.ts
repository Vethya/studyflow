import type { TaskFilters } from "./api/tasks";
import type { Category, AcademicTask } from "@/types/task";
import type { Schedule } from "@/types/schedule";

/** Stable cache keys shared by every screen that reads the same resource. */
export const SWR_KEYS = {
  session: "studyflow/session",
  tasks: "studyflow/tasks",
  availabilityWindows: "studyflow/availability/windows",
  unavailablePeriods: "studyflow/availability/unavailable-periods",
  studyPreferences: "studyflow/account/preferences",
  profile: "studyflow/account/profile",
  identities: "studyflow/account/identities",
  deletionStatus: "studyflow/account/deletion-status",
  activeSchedule: "studyflow/schedule/active",
  pendingRevision: "studyflow/schedule/pending-revision",
  effortProgress: "studyflow/progress/effort",
} as const;

export function taskListKey(filters: TaskFilters = {}) {
  if (
    filters.course === undefined &&
    filters.category === undefined &&
    filters.priority === undefined &&
    filters.status === undefined &&
    filters.deadlineFrom === undefined &&
    filters.deadlineTo === undefined
  ) {
    return SWR_KEYS.tasks;
  }
  return [SWR_KEYS.tasks, filters] as const;
}

export function taskDetailKey(taskId: string) {
  return ["studyflow/task", taskId] as const;
}

function taskDataRevision(tasks: AcademicTask[]): string {
  return tasks
    .map((task) =>
      [
        task.id,
        task.updatedAt,
        task.title,
        task.status,
        task.remainingDuration,
        task.plannedDuration,
      ].join(":"),
    )
    .join("|");
}

function scheduleDataRevision(schedule: Schedule | null): string {
  if (!schedule) return "empty";
  return schedule.sessions
    .map((session) =>
      [
        session.id,
        session.startTime,
        session.endTime,
        session.outcome ?? "pending",
        session.actualDuration ?? "",
        session.plannedDuration,
      ].join(":"),
    )
    .join("|");
}

export function activeScheduleKey(tasks: AcademicTask[] | null) {
  return tasks === null
    ? null
    : [SWR_KEYS.activeSchedule, taskDataRevision(tasks)] as const;
}

export function effortProgressKey(
  tasks: AcademicTask[] | null,
  schedule: Schedule | null,
  scheduleLoading: boolean,
) {
  return tasks === null || scheduleLoading
    ? null
    : [
        SWR_KEYS.effortProgress,
        taskDataRevision(tasks),
        scheduleDataRevision(schedule),
      ] as const;
}

export function adaptiveEstimateKey(category: Category, originalEstimate: number) {
  return ["studyflow/adaptive-estimate", category, originalEstimate] as const;
}
