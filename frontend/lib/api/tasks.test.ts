import { afterEach, expect, it, vi } from "vitest";
import {
  createTask,
  deleteTask,
  finishTaskEarly,
  listTasks,
  searchTasks,
  startTask,
  updateTask,
} from "./tasks";
import type { WireAcademicTask, WireEffortProgress } from "./wire";
import type { TaskFormData } from "@/types/task";

afterEach(() => vi.unstubAllGlobals());

const wireTask: WireAcademicTask = {
  id: "task-1",
  title: "Read chapter",
  category: "reading",
  priority: "high",
  course: "Algorithms",
  notes: "Take notes",
  deadline_at: "2026-10-10T12:00:00+07:00",
  original_estimate_minutes: 90,
  adaptive_estimate_minutes: null,
  planned_source: "original",
  planned_duration_minutes: 90,
  estimate_frozen: false,
  created_at: "2026-09-01T12:00:00Z",
  updated_at: "2026-09-01T12:00:00Z",
  status: "not_started",
};

const progress: WireEffortProgress = {
  task_id: "task-1",
  task_title: "Read chapter",
  actual_duration_minutes: 30,
  estimated_remaining_minutes: 60,
  effort_percent: 33,
  sessions_completed: 1,
  sessions_upcoming: 2,
  status: "in_progress",
};

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const form: TaskFormData = {
  title: "  Read chapter  ",
  category: "Exam Preparation",
  priority: "Medium",
  course: "  Algorithms  ",
  notes: "  Focus on proofs  ",
  deadline: "2026-10-10T12:00:00+07:00",
  originalEstimate: 120,
  plannedSource: "Adaptive",
};

it("builds task filters and joins server progress without recalculating it", async () => {
  const fetchMock = stubFetch((url) => {
    if (url.endsWith("/progress")) return Response.json([progress]);
    expect(url).toContain("/tasks?");
    expect(url).toContain("course=Algorithms");
    expect(url).toContain("category=exam_preparation");
    expect(url).toContain("priority=high");
    expect(url).toContain("status=in_progress");
    expect(url).toContain("query=proof");
    expect(url).toContain("limit=10");
    return Response.json([wireTask]);
  });

  await expect(
    listTasks({
      course: "Algorithms",
      category: "Exam Preparation",
      priority: "High",
      status: "In Progress",
      query: "proof",
      limit: 10,
    }),
  ).resolves.toMatchObject([
    {
      id: "task-1",
      category: "Reading",
      priority: "High",
      actualDuration: 30,
      remainingDuration: 60,
      sessionsCompleted: 1,
    },
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("returns no search request for blank input and maps a trimmed search request", async () => {
  const fetchMock = stubFetch((url) => {
    expect(url).toBe("/api/v1/tasks?query=chapter&limit=5");
    return Response.json([wireTask]);
  });

  await expect(searchTasks("   ")).resolves.toEqual([]);
  await expect(searchTasks("  chapter  ", undefined, 5)).resolves.toMatchObject([{ id: "task-1" }]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("sends the complete task form using backend enum and null conventions", async () => {
  const fetchMock = stubFetch(() => Response.json(wireTask));

  await createTask(form);
  await updateTask("task-1", form);

  const expectedBody = {
    title: "Read chapter",
    category: "exam_preparation",
    priority: "medium",
    course: "Algorithms",
    notes: "Focus on proofs",
    deadline_at: form.deadline,
    original_estimate_minutes: 120,
    planned_source: "adaptive",
  };
  expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual(expectedBody);
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/tasks/task-1");
  expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual(expectedBody);
});

it("uses explicit confirmation for task mutations", async () => {
  const fetchMock = stubFetch(() => new Response(null, { status: 204 }));

  await startTask("task-1");
  await finishTaskEarly("task-1");
  await deleteTask("task-1");

  expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
    ["/api/v1/tasks/task-1/start", "POST", undefined],
    ["/api/v1/tasks/task-1/finish-early", "POST", JSON.stringify({ confirmed: true })],
    ["/api/v1/tasks/task-1?confirmed=true", "DELETE", undefined],
  ]);
});
