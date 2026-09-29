// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, use: (value: unknown) => value && typeof (value as Promise<unknown>).then === "function" ? { taskId: "task-1" } : actual.use(value as never) };
});

const state = vi.hoisted(() => ({
  detail: "normal" as "normal" | "loading" | "error" | "missing",
  schedule: "normal" as "normal" | "loading",
  task: null as any,
  sessions: [] as any[],
  router: { push: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  api: { start: vi.fn(), finish: vi.fn(), remove: vi.fn() },
  allTasksNull: false,
  allTasksOther: false,
}));
const MockApiError = vi.hoisted(() => class extends Error {
  status: number;
  isNotFound: boolean;
  constructor(status: number) { super("api error"); this.status = status; this.isNotFound = status === 404; }
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1", title: "Read algorithms", category: "Reading", deadline: "2026-10-02T12:00:00Z", priority: "High",
  originalEstimate: 120, plannedSource: "Original", plannedDuration: 120, actualDuration: 30, remainingDuration: 90,
  adaptiveEstimate: 150, course: "Algorithms", notes: "Read the chapter", status: "Not Started", sessionsCompleted: 1, sessionsUpcoming: 1,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", ...overrides,
});

vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/hooks/use-api", () => ({
  describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error",
  useApi: (key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    if (loader) void loader(new AbortController().signal);
    const name = Array.isArray(key) ? String(key[0]) : String(key);
    if (name === "studyflow/task") {
      if (state.detail === "loading") return { data: null, error: null, isLoading: true, reload: vi.fn(), setData: vi.fn() };
      if (state.detail === "error") return { data: null, error: new Error("load failed"), isLoading: false, reload: vi.fn(), setData: vi.fn() };
      if (state.detail === "missing") return { data: null, error: new MockApiError(404), isLoading: false, reload: vi.fn(), setData: vi.fn() };
      return { data: state.task, error: null, isLoading: false, reload: vi.fn(), setData: vi.fn() };
    }
    if (name === "studyflow/schedule/active") return { data: state.schedule === "normal" ? { sessions: state.sessions } : null, error: null, isLoading: state.schedule === "loading", reload: vi.fn(), setData: vi.fn() };
    return { data: state.allTasksNull ? null : state.allTasksOther ? [{ id: "other-task" }, state.task] : [state.task], error: null, isLoading: false, reload: vi.fn(), setData: vi.fn() };
  },
}));
vi.mock("@/lib/api", () => ({ ApiError: MockApiError, tasks: { getTask: vi.fn(), listTasks: vi.fn(), startTask: state.api.start, finishTaskEarly: state.api.finish, deleteTask: state.api.remove }, scheduling: { getActiveSchedule: vi.fn() } }));
vi.mock("@/components/page-kit", () => ({
  SectionCard: ({ title, action, children }: any) => <section><h2>{title}</h2>{action}{children}</section>,
}));
vi.mock("@/components/task-form-dialog", () => ({ TaskFormDialog: ({ open, onSaved, onOpenChange }: any) => open ? <div role="dialog">Edit task <button onClick={() => { onSaved(makeTask({ title: "Edited" })); onOpenChange(false); }}>Save edited task</button></div> : null }));
vi.mock("@/components/record-outcome-dialog", () => ({ RecordOutcomeDialog: ({ open, onRecorded, onOpenChange }: any) => open ? <div role="dialog"><button onClick={() => { onRecorded({ session: { ...state.sessions[0], outcome: "Completed", actualDuration: 50 }, revision: { id: "revision-1" } }); onOpenChange(false); }}>Save outcome</button></div> : <button onClick={() => onRecorded({ session: { ...state.sessions[0], outcome: "Completed", actualDuration: 50 }, revision: null })}>Invoke outcome</button> }));
vi.mock("@/components/schedule-preview", () => ({ SchedulePreview: ({ open, onAccepted, onRejected }: any) => open ? <div><button onClick={onAccepted}>Accept schedule</button><button onClick={onRejected}>Reject schedule</button></div> : null }));
vi.mock("@/components/adaptive-estimate", () => ({ PersistedEstimateNote: () => <div>Adaptive estimate note</div> }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: ({ open, confirmLabel, onConfirm }: any) => open ? <button onClick={() => void onConfirm()}>{confirmLabel}</button> : null }));

import TaskDetailPage from "./(app)/tasks/[taskId]/page";

beforeEach(() => {
  state.detail = "normal";
  state.schedule = "normal";
  state.allTasksNull = false;
  state.allTasksOther = false;
  state.task = makeTask();
  state.sessions = [
    { id: "done", taskId: "task-1", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z", plannedDuration: 60, outcome: "Completed", actualDuration: 55 },
    { id: "done-no-duration", taskId: "task-1", startTime: "2026-01-03T10:00:00Z", endTime: "2026-01-03T11:00:00Z", plannedDuration: 60, outcome: "Completed" },
    { id: "past", taskId: "task-1", startTime: "2026-01-02T10:00:00Z", endTime: "2026-01-02T11:00:00Z", plannedDuration: 45 },
    { id: "future", taskId: "task-1", startTime: "2099-01-01T10:00:00Z", endTime: "2099-01-01T11:00:00Z", plannedDuration: 30 },
    { id: "other", taskId: "other", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z", plannedDuration: 30 },
  ];
  state.api.start.mockResolvedValue(undefined);
  state.api.finish.mockResolvedValue(undefined);
  state.api.remove.mockResolvedValue(undefined);
  vi.clearAllMocks();
});
afterEach(cleanup);

const page = () => <TaskDetailPage params={Promise.resolve({ taskId: "task-1" })} />;

describe("task detail page", () => {
  it("covers loading, errors, task actions, session history, outcome, and deletion", async () => {
    state.detail = "loading";
    render(page());
    expect(screen.getByRole("link", { name: "All tasks" })).toBeTruthy();
    cleanup();
    state.detail = "missing";
    render(page());
    expect(screen.getByText("This task no longer exists.")).toBeTruthy();
    cleanup();
    state.detail = "error";
    render(page());
    expect(screen.getByText("load failed")).toBeTruthy();
    screen.getByRole("button", { name: "Retry" }).click();
    cleanup();

    state.task = makeTask({ status: "Not Started" });
    state.detail = "normal";
    render(page());
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => expect(state.api.start).toHaveBeenCalled());
    screen.getByRole("button", { name: "Edit" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save edited task" })).toBeTruthy());
    screen.getByRole("button", { name: "Save edited task" }).click();
    screen.getByRole("button", { name: "Record what happened" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save outcome" })).toBeTruthy());
    screen.getByRole("button", { name: "Save outcome" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept schedule" })).toBeTruthy());
    screen.getByRole("button", { name: "Accept schedule" }).click();
    screen.getByRole("button", { name: "Record what happened" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save outcome" })).toBeTruthy());
    screen.getByRole("button", { name: "Save outcome" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject schedule" })).toBeTruthy());
    screen.getByRole("button", { name: "Reject schedule" }).click();
    screen.getByRole("button", { name: "Delete" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete task" }).click();
    await waitFor(() => expect(state.api.remove).toHaveBeenCalled());
  });

  it("covers in-progress finish branches, schedule loading, and failed mutations", async () => {
    cleanup();
    state.task = makeTask({ status: "In Progress", plannedSource: "Adaptive" });
    state.schedule = "loading";
    state.api.finish.mockRejectedValueOnce(new MockApiError(409));
    state.api.remove.mockRejectedValueOnce(new Error("delete failed"));
    render(page());
    expect(screen.getAllByRole("heading", { name: "Study sessions" }).length).toBe(1);
    screen.getByRole("button", { name: "Finish early" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark it finished" })).toBeTruthy());
    screen.getByRole("button", { name: "Mark it finished" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("Start the task before finishing it early."));
    screen.getByRole("button", { name: "Delete" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete task" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("delete failed"));
  });

  it("reports non-conflict finish failures and handles an empty session history", async () => {
    state.task = makeTask({ status: "In Progress", notes: undefined, course: undefined, adaptiveEstimate: undefined });
    state.sessions = [];
    state.api.finish.mockRejectedValueOnce(new Error("finish failed"));
    render(page());
    expect(screen.getByText(/No sessions yet/)).toBeTruthy();
    screen.getByRole("button", { name: "Finish early" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark it finished" })).toBeTruthy());
    screen.getByRole("button", { name: "Mark it finished" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("finish failed"));
  });

  it("handles a recorded outcome when the schedule is unavailable", () => {
    state.schedule = "loading";
    render(page());
    screen.getByRole("button", { name: "Invoke outcome" }).click();
    expect(screen.getByRole("heading", { name: "Study sessions" })).toBeTruthy();
  });

  it("covers missing task-list state and overdue emphasis", async () => {
    state.allTasksNull = true;
    state.task = makeTask({ status: "Overdue", deadline: "2026-09-01T12:00:00Z" });
    render(page());
    expect(screen.getByText("Read algorithms")).toBeTruthy();

    cleanup();
    state.allTasksNull = true;
    state.task = makeTask({ status: "In Progress" });
    state.api.finish.mockRejectedValueOnce(new Error("finish without schedule"));
    render(page());
    screen.getByRole("button", { name: "Finish early" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark it finished" })).toBeTruthy());
    screen.getByRole("button", { name: "Mark it finished" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("finish without schedule"));

    cleanup();
    state.allTasksNull = true;
    state.api.remove.mockResolvedValueOnce(undefined);
    render(page());
    screen.getByRole("button", { name: "Delete" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete task" }).click();
    await waitFor(() => expect(state.api.remove).toHaveBeenCalled());

    cleanup();
    state.allTasksNull = true;
    state.api.remove.mockRejectedValueOnce(new Error("delete without schedule"));
    render(page());
    screen.getByRole("button", { name: "Delete" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete task" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("delete without schedule"));

    cleanup();
    state.allTasksOther = true;
    state.allTasksNull = false;
    state.task = makeTask({ status: "Not Started" });
    render(page());
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => expect(state.api.start).toHaveBeenCalled());
  });
});
