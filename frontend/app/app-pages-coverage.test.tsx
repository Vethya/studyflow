// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "normal" as "normal" | "loading" | "error" | "empty",
  mobile: false,
  resources: {} as Record<string, any>,
  account: null as { name: string; email: string } | null,
  mutate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  api: {
    deleteTask: vi.fn(),
    generateProposal: vi.fn(),
  },
}));

const task = {
  id: "task-1", title: "Read algorithms", category: "Reading", deadline: "2026-10-02T12:00:00Z",
  priority: "High", originalEstimate: 120, plannedSource: "Original", plannedDuration: 120,
  actualDuration: 30, remainingDuration: 90, course: "Algorithms", notes: "Notes", status: "In Progress",
  sessionsCompleted: 1, sessionsUpcoming: 1, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z",
};
const taskWithSameDeadline = { ...task, id: "task-same-deadline", title: "Review notes" };
const completedTask = { ...task, id: "task-done", title: "Finished", status: "Completed", remainingDuration: 0 };
const overdueTask = { ...task, id: "task-old", title: "Overdue task", status: "Overdue", deadline: "2026-09-20T12:00:00Z" };
const windows = Array.from({ length: 7 }, (_, dayOfWeek) => ({ id: `window-${dayOfWeek}`, dayOfWeek, startTime: "09:00", endTime: "17:00" }));
const blocked = [{ id: "block-1", title: "Class", startDate: "2026-09-30T12:00:00Z", endDate: "2026-09-30T13:00:00Z", reason: "Class" }];
const session = { id: "session-1", taskId: task.id, taskTitle: task.title, category: task.category, startTime: "2026-09-29T11:00:00Z", endTime: "2026-09-29T12:00:00Z", plannedDuration: 60, isAwaitingOutcome: false };
const waitingSession = { ...session, id: "session-waiting", startTime: "2026-09-28T11:00:00Z", endTime: "2026-09-28T12:00:00Z", isAwaitingOutcome: true };
const finishedSession = { ...session, id: "session-finished", startTime: "2026-09-27T11:00:00Z", endTime: "2026-09-27T12:00:00Z", outcome: "Completed", actualDuration: 50 };
const finishedSession2 = { ...finishedSession, id: "session-finished-2", startTime: "2026-09-28T09:00:00Z", endTime: "2026-09-28T10:00:00Z", outcome: "Delayed", actualDuration: 35 };
const secondSession = { ...session, id: "session-2", startTime: "2026-09-30T11:00:00Z", endTime: "2026-09-30T12:00:00Z" };
const secondWaitingSession = { ...waitingSession, id: "session-waiting-2", startTime: "2026-09-27T09:00:00Z", endTime: "2026-09-27T10:00:00Z" };
const schedule = { id: "schedule-1", sessions: [session, secondSession, waitingSession, secondWaitingSession, finishedSession, finishedSession2], createdAt: "2026-09-01T00:00:00Z", isActive: true };
const proposal = { id: "proposal-1", proposedSessions: [session], unscheduledWork: [{ taskId: task.id, taskTitle: task.title, remainingMinutes: 90, reason: "No slot" }], overloadWarnings: [], createdAt: "2026-09-29T00:00:00Z" };
const preferences = { timezone: "UTC", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: false };
const progressRows = [
  { taskId: task.id, taskTitle: task.title, actualDuration: 30, estimatedRemaining: 90, effortPercent: 25, sessionsCompleted: 1, sessionsUpcoming: 2, status: "In Progress" },
  { taskId: completedTask.id, taskTitle: completedTask.title, actualDuration: 60, estimatedRemaining: 0, effortPercent: 100, sessionsCompleted: 2, sessionsUpcoming: 0, status: "Completed" },
  { taskId: overdueTask.id, taskTitle: overdueTask.title, actualDuration: 0, estimatedRemaining: 45, effortPercent: 0, sessionsCompleted: 0, sessionsUpcoming: 0, status: "Overdue" },
];

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => new Date("2026-09-29T10:00:00Z") }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ account: state.account, status: "authenticated", signOut: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/use-api", () => ({
  describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error",
  useApi: (key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    if (loader) void loader(new AbortController().signal);
    const head = Array.isArray(key) ? String(key[0]) : String(key ?? "");
    const resource = state.resources[head] ?? { data: null };
    if (state.mode === "loading") return { data: null, error: null, isLoading: true, isValidating: true, reload: vi.fn(), setData: vi.fn() };
    if (state.mode === "error" && (head === "studyflow/tasks" || head === "studyflow/availability/windows")) return { data: null, error: new Error("load failed"), isLoading: false, isValidating: false, reload: vi.fn(), setData: vi.fn() };
    return { data: resource.data ?? null, error: resource.error ?? null, isLoading: false, isValidating: false, reload: resource.reload ?? vi.fn(), setData: resource.setData ?? vi.fn() };
  },
}));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: state.mutate }) }));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/lib/api", () => {
  class ScheduleTechnicalFailure extends Error {}
  return {
    ScheduleTechnicalFailure,
    account: { getPreferences: vi.fn() },
    availability: { listWindows: vi.fn(), listUnavailablePeriods: vi.fn(), replaceWindows: vi.fn() },
    scheduling: {
      getActiveSchedule: vi.fn(), getPendingRevision: vi.fn(), generateProposal: state.api.generateProposal,
      recordOutcome: vi.fn(), acceptProposal: vi.fn(), rejectProposal: vi.fn(),
      listEffortProgress: vi.fn(),
    },
    tasks: { listTasks: vi.fn(), deleteTask: state.api.deleteTask, updateTask: vi.fn(), createTask: vi.fn() },
  };
});

vi.mock("@/components/page-kit", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{actions}</header>,
  Figure: ({ label, value, hint }: { label: string; value: string | null; hint?: string }) => <div><span>{label}</span><span>{value ?? "loading"}</span>{hint && <small>{hint}</small>}</div>,
  FigureRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionCard: ({ title, description, action, children, footer }: { title?: string; description?: string; action?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) => <section>{title && <h2>{title}</h2>}<p>{description}</p>{action}{children}{footer}</section>,
  EmptyState: ({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) => <div><h2>{title}</h2><p>{children}</p>{action}</div>,
}));
vi.mock("@/components/capacity-bar", () => ({ CapacityBar: ({ available, committed }: any) => <div>capacity {available}/{committed}</div> }));
vi.mock("@/components/shortfall-card", () => ({ ShortfallCard: ({ item }: any) => <div>shortfall {item.task.title}</div> }));
vi.mock("@/components/onboarding", () => ({ WelcomeTour: () => <div>welcome</div>, GettingStarted: () => <div>getting started</div> }));
vi.mock("@/components/unscheduled-work-list", () => ({ UnscheduledWorkList: ({ items }: any) => <ul>{items.map((item: any) => <li key={item.taskId}>{item.taskTitle}</li>)}</ul> }));
vi.mock("@/components/schedule-preview", () => ({
  PendingPlanBanner: ({ onReview }: any) => <button onClick={onReview}>Review plan</button>,
  SchedulePreview: ({ open, onAccepted, onRejected }: any) => open ? <div><button onClick={onAccepted}>Accept preview</button><button onClick={onRejected}>Reject preview</button></div> : null,
}));
vi.mock("@/components/record-outcome-dialog", () => ({ RecordOutcomeDialog: ({ open, onRecorded, onOpenChange }: any) => open ? <><button onClick={() => { onRecorded({ session: { ...session, outcome: "Completed", actualDuration: 60 }, revision: null }); onOpenChange(false); }}>Save outcome</button><button onClick={() => onOpenChange(false)}>Close outcome</button></> : <button onClick={() => onRecorded({ session: { ...session, outcome: "Completed", actualDuration: 60 }, revision: null })}>Invoke outcome without schedule</button> }));
vi.mock("@/components/plan-generation-dialog", () => ({ PlanGenerationDialog: ({ open }: any) => open ? <div>Generating plan</div> : null }));
vi.mock("@/components/task-form-dialog", () => ({ TaskFormDialog: ({ open, onSaved }: any) => open ? <button onClick={() => onSaved(task)}>Save task</button> : null }));
vi.mock("@/components/session-drawer", () => ({ SessionDrawer: ({ open, onEditTask, onDeleteTask, onRecordOutcome, onOpenChange, onOpenChangeComplete }: any) => open ? <div><button onClick={onEditTask}>Edit session task</button><button onClick={onDeleteTask}>Delete session task</button><button onClick={onRecordOutcome}>Record session outcome</button><button onClick={() => { onOpenChangeComplete?.(false); onOpenChange?.(false); }}>Close session</button><button onClick={() => { onOpenChangeComplete?.(true); onOpenChange?.(true); }}>Open session event</button></div> : null }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: ({ open, onConfirm, onOpenChange, confirmLabel }: any) => open ? <><button onClick={() => void onConfirm()}>{confirmLabel ?? "Delete task"}</button><button onClick={() => onOpenChange?.(false)}>Cancel task</button></> : <button onClick={() => void onConfirm()}>Invoke {confirmLabel ?? "Delete task"} with no target</button> }));
vi.mock("@/components/week-grid", () => ({
  GridLegend: () => <div>grid legend</div>,
  WeekGrid: ({ blocks, columns, renderLane }: any) => <div>{blocks.map((block: any) => <button key={block.id} onClick={() => block.onSelect?.({ currentTarget: document.body })}>{block.title ?? block.label ?? block.id}</button>)}{columns.map((column: any) => <div key={column.key}>{renderLane?.(column)}</div>)}</div>,
}));
vi.mock("@/components/ui/calendar", () => ({ Calendar: ({ onSelect }: any) => <button onClick={() => onSelect?.(new Date("2026-10-01T00:00:00Z"))}>Pick date</button> }));
vi.mock("@/components/ui/popover", () => ({ Popover: ({ children }: any) => <div>{children}</div>, PopoverTrigger: ({ render, children }: any) => render ?? <button>{children}</button>, PopoverContent: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ui/tabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/tabs")>();
  return {
    ...actual,
    Tabs: ({ children, onValueChange, ...props }: any) => <><actual.Tabs {...props} onValueChange={onValueChange}>{children}</actual.Tabs><button type="button" onClick={() => onValueChange?.(null)}>Invoke null horizon</button></>,
  };
});

import DashboardPage from "./(app)/dashboard/page";
import ProgressPage from "./(app)/progress/page";
import CalendarPage from "./(app)/calendar/page";
import { ScheduleTechnicalFailure } from "@/lib/api";

function setNormalResources(overrides: Record<string, any> = {}) {
  state.mode = "normal";
  state.resources = {
    "studyflow/tasks": { data: [task, taskWithSameDeadline, completedTask, overdueTask] },
    "studyflow/availability/windows": { data: windows },
    "studyflow/availability/unavailable-periods": { data: blocked },
    "studyflow/account/preferences": { data: preferences },
    "studyflow/schedule/active": { data: schedule },
    "studyflow/schedule/pending-revision": { data: proposal },
    "studyflow/progress/effort": { data: progressRows },
    ...overrides,
  };
}

beforeEach(() => {
  setNormalResources();
  state.mobile = false;
  state.account = { name: "Student Name", email: "student@example.com" };
  state.api.deleteTask.mockResolvedValue(undefined);
  state.api.generateProposal.mockResolvedValue(proposal);
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("dashboard and progress pages", () => {
  it("renders dashboard data, changes horizons, records outcomes, and reviews plans", async () => {
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Hello, Student" })).toBeTruthy();
    screen.getByRole("tab", { name: "30 days" }).click();
    screen.getByRole("button", { name: "Invoke null horizon" }).click();
    screen.getByRole("button", { name: "Review plan" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept preview" })).toBeTruthy());
    screen.getByRole("button", { name: "Reject preview" }).click();
    screen.getByRole("button", { name: "Review plan" }).click();
    screen.getByRole("button", { name: "Accept preview" }).click();
    screen.getByRole("button", { name: "Record what happened" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close outcome" })).toBeTruthy());
    screen.getByRole("button", { name: "Close outcome" }).click();
    screen.getByRole("button", { name: "Record what happened" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save outcome" })).toBeTruthy());
    screen.getByRole("button", { name: "Save outcome" }).click();
    screen.getByRole("button", { name: "Close outcome" }).click();
    expect(screen.getByText("This week’s effort")).toBeTruthy();
  });

  it("covers dashboard unscheduled work and empty future sessions", () => {
    setNormalResources({
      "studyflow/schedule/pending-revision": { data: null },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [] } },
      "studyflow/tasks": { data: [task] },
    });
    render(<DashboardPage />);
    expect(screen.getByText(/no plan yet/i)).toBeTruthy();
    screen.getByRole("button", { name: "Invoke outcome without schedule" }).click();
  });

  it("covers dashboard singular copy, past sessions, empty names, and capacity verdicts", () => {
    state.account = { name: "   ", email: "student@example.com" };
    setNormalResources({
      "studyflow/tasks": { data: [{ ...task, course: undefined, remainingDuration: 15 }] },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [{ ...finishedSession, isAwaitingOutcome: false }] } },
      "studyflow/schedule/pending-revision": { data: null },
    });
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByText("No sessions coming up")).toBeTruthy();
    expect(screen.getByText("Open the calendar")).toBeTruthy();

    cleanup();
    setNormalResources({
      "studyflow/tasks": { data: [{ ...task, id: "tight", remainingDuration: 50000, course: undefined }] },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [{ ...waitingSession, id: "one-waiting" }] } },
      "studyflow/schedule/pending-revision": { data: null },
    });
    render(<DashboardPage />);
    expect(screen.getByText("1 session is waiting on you")).toBeTruthy();
    expect(screen.getByText(/1 task does not fit/)).toBeTruthy();
  });

  it("builds unscheduled work from active sessions when no proposal is pending", () => {
    setNormalResources({
      "studyflow/schedule/pending-revision": { data: null },
      "studyflow/tasks": { data: [task, taskWithSameDeadline] },
      "studyflow/schedule/active": { data: schedule },
    });
    render(<DashboardPage />);
    expect(screen.getAllByText("Review notes").length).toBeGreaterThan(0);
  });

  it("covers plural overload copy, missing account data, and an outcome without a schedule", () => {
    state.account = null;
    const overloaded = Array.from({ length: 4 }, (_, index) => ({
      ...task,
      id: `overloaded-${index}`,
      title: `Overloaded ${index + 1}`,
      deadline: "2026-10-01T12:00:00Z",
      remainingDuration: 50000,
    }));
    setNormalResources({
      "studyflow/tasks": { data: overloaded },
      "studyflow/availability/windows": { data: [windows[1]] },
      "studyflow/schedule/active": { data: null },
      "studyflow/schedule/pending-revision": { data: null },
    });
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByText(/4 tasks do not fit/)).toBeTruthy();
    screen.getByRole("button", { name: "Invoke outcome without schedule" }).click();
  });

  it("labels a future session by date instead of today", () => {
    setNormalResources({
      "studyflow/tasks": { data: [task] },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [{ ...session, startTime: "2026-09-30T11:00:00Z", endTime: "2026-09-30T12:00:00Z" }] } },
      "studyflow/schedule/pending-revision": { data: null },
    });
    render(<DashboardPage />);
    expect(screen.getByText(/Wednesday, Sep 30 at 11:00/)).toBeTruthy();
  });

  it("covers dashboard loading, error, empty, and no-session branches", async () => {
    state.mode = "loading";
    const { rerender } = render(<DashboardPage />);
    expect(screen.getAllByText("loading").length).toBeGreaterThan(0);
    cleanup();
    state.mode = "error";
    render(<DashboardPage />);
    expect(screen.getByText("Could not load your dashboard")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    cleanup();
    setNormalResources({ "studyflow/availability/windows": { data: [] }, "studyflow/schedule/active": { data: { ...schedule, sessions: [] } }, "studyflow/schedule/pending-revision": { data: null }, "studyflow/tasks": { data: [] } });
    render(<DashboardPage />);
    expect(screen.getByText("No study time set yet")).toBeTruthy();
    cleanup();
    setNormalResources({ "studyflow/schedule/active": { data: { ...schedule, sessions: [] } }, "studyflow/schedule/pending-revision": { data: null }, "studyflow/tasks": { data: [] } });
    render(<DashboardPage />);
    expect(screen.getByText(/Nothing due in this window/)).toBeTruthy();
  });

  it("renders progress rows and history plus loading/error/empty states", async () => {
    render(<ProgressPage />);
    expect(screen.getByRole("heading", { name: "Progress" })).toBeTruthy();
    expect(screen.getAllByText("Read algorithms").length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    cleanup();
    state.mode = "loading";
    render(<ProgressPage />);
    expect(screen.getAllByText("loading").length).toBeGreaterThan(0);
    cleanup();
    state.mode = "error";
    render(<ProgressPage />);
    expect(screen.getByText("Could not load your progress")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    cleanup();
    setNormalResources({ "studyflow/tasks": { data: [] }, "studyflow/progress/effort": { data: [] }, "studyflow/schedule/active": { data: { ...schedule, sessions: [] } } });
    render(<ProgressPage />);
    expect(screen.getByText("No tasks yet")).toBeTruthy();
    expect(screen.getByText("Nothing recorded yet")).toBeTruthy();
    cleanup();
    setNormalResources({
      "studyflow/tasks": { data: [{ ...task, id: "known", course: undefined }] },
      "studyflow/progress/effort": { data: [{ ...progressRows[0], taskId: "unknown", taskTitle: "Unknown task" }] },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [{ ...finishedSession, outcome: "Missed", actualDuration: undefined }] } },
    });
    render(<ProgressPage />);
    expect(screen.getByText("Other")).toBeTruthy();
  });
});

describe("calendar page", () => {
  it("navigates, generates a plan, edits sessions, and deletes a task", async () => {
    render(<CalendarPage />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
    screen.getByRole("button", { name: "Next week" }).click();
    screen.getByRole("button", { name: "This week" }).click();
    screen.getByRole("button", { name: "Previous week" }).click();
    screen.getByRole("button", { name: "Jump to" }).click();
    screen.getByRole("button", { name: "Pick date" }).click();
    screen.getByRole("button", { name: "Plan my time" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept preview" })).toBeTruthy());
    screen.getByRole("button", { name: "Accept preview" }).click();
    screen.getByRole("button", { name: "Plan my time" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject preview" })).toBeTruthy());
    screen.getByRole("button", { name: "Reject preview" }).click();
    screen.getByRole("button", { name: "Review plan" }).click();
    screen.getByRole("button", { name: "Reject preview" }).click();
    screen.getByRole("button", { name: "Add task" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save task" })).toBeTruthy());
    screen.getByRole("button", { name: "Save task" }).click();
    screen.getAllByRole("button", { name: /Read algorithms ·/ })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Record session outcome" })).toBeTruthy());
    screen.getByRole("button", { name: "Close session" }).click();
    screen.getAllByRole("button", { name: /Read algorithms ·/ })[0].click();
    screen.getByRole("button", { name: "Record session outcome" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save outcome" })).toBeTruthy());
    screen.getByRole("button", { name: "Save outcome" }).click();
    screen.getByRole("button", { name: "Close outcome" }).click();
    screen.getAllByRole("button", { name: /Read algorithms ·/ })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit session task" })).toBeTruthy());
    screen.getByRole("button", { name: "Edit session task" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save task" })).toBeTruthy());
    screen.getByRole("button", { name: "Save task" }).click();
    screen.getAllByRole("button", { name: /Read algorithms ·/ })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete session task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete session task" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Cancel task" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Invoke Delete task with no target" })).toBeTruthy());
    screen.getByRole("button", { name: "Invoke Delete task with no target" }).click();
  });

  it("covers calendar drawer and mutation fallbacks", async () => {
    setNormalResources({
      "studyflow/tasks": { data: [{ ...task, id: "missing-task" }] },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [{ ...session, taskId: "missing-task" }] } },
    });
    render(<CalendarPage />);
    screen.getAllByRole("button", { name: /Read algorithms ·/ })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open session event" })).toBeTruthy());
    screen.getByRole("button", { name: "Open session event" }).click();
    screen.getByRole("button", { name: "Close session" }).click();

    cleanup();
    setNormalResources({
      "studyflow/tasks": { data: [{ ...task, id: "delete-fallback" }] },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [{ ...session, taskId: "delete-fallback" }] } },
    });
    state.api.deleteTask.mockRejectedValueOnce(new Error("fallback delete failed"));
    const view = render(<CalendarPage />);
    screen.getAllByRole("button", { name: /Read algorithms ·/ })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete session task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete session task" }).click();
    state.resources["studyflow/tasks"].data = null;
    state.resources["studyflow/schedule/active"].data = null;
    view.rerender(<CalendarPage />);
    screen.getByRole("button", { name: "Delete task" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("fallback delete failed"));

    cleanup();
    setNormalResources({ "studyflow/schedule/active": { data: null } });
    render(<CalendarPage />);
    screen.getByRole("button", { name: "Invoke outcome without schedule" }).click();
  });

  it("covers mobile, loading/error, technical generation failure, and empty calendar", async () => {
    cleanup();
    state.mobile = true;
    setNormalResources();
    render(<CalendarPage />);
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    const today = screen.getByRole("button", { name: "Today" });
    await waitFor(() => expect((today as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(today);
    cleanup();
    state.mode = "loading";
    render(<CalendarPage />);
    expect(screen.getAllByText("loading").length).toBeGreaterThan(0);
    cleanup();
    state.mode = "error";
    render(<CalendarPage />);
    expect(screen.getByText("Could not load your calendar")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    cleanup();
    setNormalResources({ "studyflow/tasks": { data: [] }, "studyflow/availability/windows": { data: [] }, "studyflow/availability/unavailable-periods": { data: [] }, "studyflow/schedule/active": { data: { ...schedule, sessions: [] } }, "studyflow/schedule/pending-revision": { data: null } });
    state.api.generateProposal.mockRejectedValueOnce(new Error("planner failed"));
    render(<CalendarPage />);
    screen.getByRole("button", { name: "Plan my time" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("planner failed"));
    expect(screen.getByText("Nothing due in the next two weeks.")).toBeTruthy();

    state.api.generateProposal.mockRejectedValueOnce(new ScheduleTechnicalFailure("technical failure"));
    screen.getByRole("button", { name: "Plan my time" }).click();
    await waitFor(() => expect(screen.getByText(/technical failure/)).toBeTruthy());
    screen.getByRole("button", { name: "Try again" }).click();

    cleanup();
    state.mobile = false;
    setNormalResources();
    state.api.deleteTask.mockRejectedValueOnce(new Error("delete failed"));
    render(<CalendarPage />);
    screen.getAllByRole("button", { name: /Read algorithms ·/ })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete session task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete session task" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete task" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("delete failed"));
  });

  it("deletes a task from the session drawer", async () => {
    setNormalResources();
    render(<CalendarPage />);
    screen.getAllByRole("button", { name: /Read algorithms ·/ })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete session task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete session task" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete task" }).click();
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith("Task deleted"));
  });

  it("covers calendar edge ranges, urgent deadlines, and oversized task groups", () => {
    const oneDue = { ...task, id: "due-today", title: "Due today", deadline: "2026-09-29T23:00:00Z" };
    const { rerender } = render(<CalendarPage />);
    setNormalResources({
      "studyflow/tasks": { data: [oneDue] },
      "studyflow/availability/windows": { data: [{ ...windows[0], startTime: "20:00", endTime: "17:30" }] },
      "studyflow/availability/unavailable-periods": { data: [] },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [{ ...session, startTime: "2026-09-29T23:00:00Z", endTime: "2026-09-30T00:00:00Z" }] } },
      "studyflow/schedule/pending-revision": { data: null },
    });
    rerender(<CalendarPage />);
    expect(screen.getByText("Deadline here")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();

    cleanup();
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...task,
      id: `many-${index}`,
      title: `Many ${index + 1}`,
      deadline: "2026-09-30T12:00:00Z",
      status: "Not Started",
    }));
    setNormalResources({
      "studyflow/tasks": { data: many },
      "studyflow/availability/windows": { data: [] },
      "studyflow/availability/unavailable-periods": { data: [] },
      "studyflow/schedule/active": { data: { ...schedule, sessions: [] } },
      "studyflow/schedule/pending-revision": { data: null },
    });
    render(<CalendarPage />);
    expect(screen.getByText("Deadlines here")).toBeTruthy();
    expect(screen.getByText("+1 more")).toBeTruthy();
  });
});
