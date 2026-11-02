/** Academic task endpoints — `backend/src/studyflow/api/tasks.py`. */

import { apiJson, apiJsonWithHeaders, apiVoid, buildQuery } from "./client";
import {
  toAcademicTask,
  toWireCategory,
  toWirePriority,
  toWireStatus,
} from "./mappers";
import { listEffortProgress } from "./progress";
import type { EffortProgress } from "@/types/progress";
import type { AcademicTask, Category, Priority, TaskFormData, TaskStatus } from "@/types/task";
import type { WireAcademicTask, WireAcademicTaskRequest, WirePlannedSource } from "./wire";

export interface TaskFilters {
  course?: string;
  category?: Category;
  priority?: Priority;
  status?: TaskStatus;
  /** RFC 3339 timestamps with an explicit UTC offset. */
  deadlineFrom?: string;
  deadlineTo?: string;
  query?: string;
  /** Page size, 1–100. Omit for every matching task. */
  limit?: number;
  /** Rows to skip; the API orders by deadline, then id. */
  offset?: number;
}

export interface TaskPage {
  tasks: AcademicTask[];
  /** Every task matching the filters, from the `X-Total-Count` header. */
  total: number;
}

function taskQuery(filters: TaskFilters): string {
  return buildQuery({
    course: filters.course,
    category: filters.category && toWireCategory(filters.category),
    priority: filters.priority && toWirePriority(filters.priority),
    status: filters.status && toWireStatus(filters.status),
    deadline_from: filters.deadlineFrom,
    deadline_to: filters.deadlineTo,
    query: filters.query,
    limit: filters.limit,
    offset: filters.offset,
  });
}

/** The `X-Total-Count` header, or `fallback` when it is missing or unreadable. */
export function readTotalCount(headers: Headers, fallback: number): number {
  const raw = headers.get("X-Total-Count");
  const total = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isInteger(total) && total >= 0 ? total : fallback;
}

export async function listTasks(
  filters: TaskFilters = {},
  signal?: AbortSignal,
): Promise<AcademicTask[]> {
  return (await listTasksPage(filters, signal)).tasks;
}

/** One page of tasks plus the total, for callers that paginate. */
export async function listTasksPage(
  filters: TaskFilters = {},
  signal?: AbortSignal,
): Promise<TaskPage> {
  const [response, progress] = await Promise.all([
    apiJsonWithHeaders<WireAcademicTask[]>(`/tasks${taskQuery(filters)}`, { signal }),
    progressByTask(signal),
  ]);
  const tasks = response.data.map((task) => toAcademicTask(task, progress.get(task.id)));
  const skipped = filters.offset ?? 0;
  return { tasks, total: readTotalCount(response.headers, skipped + tasks.length) };
}

/**
 * Lightweight search for the top bar and autocomplete.
 * Directly queries `/tasks` without the overhead of computing `/progress`.
 */
export async function searchTasks(
  searchTerm: string,
  signal?: AbortSignal,
  limit = 15,
): Promise<AcademicTask[]> {
  const trimmed = searchTerm.trim();
  if (!trimmed) return [];
  const query = buildQuery({ query: trimmed, limit });
  const wire = await apiJson<WireAcademicTask[]>(`/tasks${query}`, { signal });
  return wire.map((task) => toAcademicTask(task));
}

export async function getTask(taskId: string, signal?: AbortSignal): Promise<AcademicTask> {
  const [wire, progress] = await Promise.all([
    apiJson<WireAcademicTask>(`/tasks/${taskId}`, { signal }),
    progressByTask(signal),
  ]);
  return toAcademicTask(wire, progress.get(taskId));
}

/** Worked, remaining and session counts come from `GET /progress`, not the task resource. */
async function progressByTask(signal?: AbortSignal): Promise<Map<string, EffortProgress>> {
  const rows = await listEffortProgress(signal);
  return new Map(rows.map((row) => [row.taskId, row]));
}

/**
 * `deadline` must carry an explicit UTC offset — a bare local datetime such as
 * the one an `<input type="datetime-local">` produces is rejected with 422.
 */
function toWireTask(form: TaskFormData): WireAcademicTaskRequest {
  return {
    title: form.title.trim(),
    category: toWireCategory(form.category),
    priority: toWirePriority(form.priority),
    course: form.course?.trim() || null,
    notes: form.notes?.trim() || null,
    deadline_at: form.deadline,
    original_estimate_minutes: form.originalEstimate,
    ...(form.plannedSource
      ? { planned_source: form.plannedSource.toLowerCase() as WirePlannedSource }
      : {}),
  };
}

export async function createTask(
  form: TaskFormData,
  signal?: AbortSignal,
): Promise<AcademicTask> {
  const wire = await apiJson<WireAcademicTask>("/tasks", {
    method: "POST",
    body: toWireTask(form),
    signal,
  });
  return toAcademicTask(wire);
}

/**
 * A full replacement, not a patch: every field must be supplied. Changing
 * `originalEstimate` after the task has been started fails with 409.
 */
export async function updateTask(
  taskId: string,
  form: TaskFormData,
  signal?: AbortSignal,
): Promise<AcademicTask> {
  const wire = await apiJson<WireAcademicTask>(`/tasks/${taskId}`, {
    method: "PUT",
    body: toWireTask(form),
    signal,
  });
  return toAcademicTask(wire);
}

/** Moves the task to In Progress and freezes its original estimate. */
export function startTask(taskId: string, signal?: AbortSignal): Promise<void> {
  return apiVoid(`/tasks/${taskId}/start`, { method: "POST", signal });
}

/** Only valid for a task that has already been started. */
export function finishTaskEarly(taskId: string, signal?: AbortSignal): Promise<void> {
  return apiVoid(`/tasks/${taskId}/finish-early`, {
    method: "POST",
    body: { confirmed: true },
    signal,
  });
}

/** Requires explicit confirmation; the backend rejects the call without it. */
export function deleteTask(taskId: string, signal?: AbortSignal): Promise<void> {
  return apiVoid(`/tasks/${taskId}?confirmed=true`, { method: "DELETE", signal });
}
