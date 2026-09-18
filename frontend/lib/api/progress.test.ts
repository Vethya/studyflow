import { afterEach, expect, it, vi } from "vitest";
import { getTask, listTasks } from "./tasks";
import { listEffortProgress } from "./progress";
import type { WireAcademicTask, WireEffortProgress } from "./wire";

afterEach(() => vi.unstubAllGlobals());

const task = (id: string, overrides: Partial<WireAcademicTask> = {}): WireAcademicTask => ({
  id,
  title: `Task ${id}`,
  category: "reading",
  priority: "medium",
  course: null,
  notes: null,
  deadline_at: "2026-10-01T12:00:00Z",
  original_estimate_minutes: 120,
  adaptive_estimate_minutes: null,
  planned_source: "original",
  planned_duration_minutes: 120,
  estimate_frozen: true,
  created_at: "2026-09-01T12:00:00Z",
  updated_at: "2026-09-01T12:00:00Z",
  status: "in_progress",
  ...overrides,
});

const progress: WireEffortProgress = {
  task_id: "a",
  task_title: "Task a",
  actual_duration_minutes: 45,
  estimated_remaining_minutes: 30,
  effort_percent: 60,
  sessions_completed: 1,
  sessions_upcoming: 2,
  status: "in_progress",
};

function stubApi(tasks: WireAcademicTask[] | WireAcademicTask) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    return Response.json(path.endsWith("/progress") ? [progress] : tasks);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("maps server effort progress without recalculating it", async () => {
  stubApi([]);
  await expect(listEffortProgress()).resolves.toEqual([
    {
      taskId: "a",
      taskTitle: "Task a",
      actualDuration: 45,
      estimatedRemaining: 30,
      effortPercent: 60,
      sessionsCompleted: 1,
      sessionsUpcoming: 2,
      status: "In Progress",
    },
  ]);
});

it("uses server remaining work instead of the planned duration for tasks", async () => {
  stubApi([task("a"), task("b"), task("c", { status: "completed" })]);
  const [withProgress, noProgress, completed] = await listTasks();

  expect(withProgress).toMatchObject({
    actualDuration: 45,
    remainingDuration: 30,
    sessionsCompleted: 1,
    sessionsUpcoming: 2,
  });
  expect(noProgress).toMatchObject({ actualDuration: 0, remainingDuration: 120 });
  expect(completed.remainingDuration).toBe(0);
});

it("merges progress into a single task", async () => {
  const fetchMock = stubApi(task("a"));
  await expect(getTask("a")).resolves.toMatchObject({ remainingDuration: 30, actualDuration: 45 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
