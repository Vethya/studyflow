// @vitest-environment jsdom
import React, { createContext, useContext } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "normal" as "normal" | "loading" | "error",
  tasks: [] as any[],
  params: new URLSearchParams(),
  api: { start: vi.fn(), finish: vi.fn(), remove: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  savedId: "task-new",
  setDataNull: false,
}));

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1", title: "Read algorithms", category: "Reading", deadline: "2026-10-02T12:00:00Z", priority: "High",
  originalEstimate: 120, plannedSource: "Original", plannedDuration: 120, actualDuration: 30, remainingDuration: 90,
  course: "Algorithms", notes: "Notes", status: "In Progress", sessionsCompleted: 1, sessionsUpcoming: 1,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", ...overrides,
});

vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/hooks/use-api", () => ({
  describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error",
  useApi: (_key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    if (loader) void loader(new AbortController().signal);
    const setData = vi.fn((update: unknown) => typeof update === "function" ? (update as (current: any[] | undefined) => any[])(state.setDataNull ? undefined : state.tasks) : update);
    if (state.mode === "loading") return { data: null, error: null, isLoading: true, isValidating: true, reload: vi.fn(), setData };
    if (state.mode === "error") return { data: null, error: new Error("tasks failed"), isLoading: false, isValidating: false, reload: vi.fn(), setData };
    return { data: state.tasks, error: null, isLoading: false, isValidating: false, reload: vi.fn(), setData };
  },
}));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/lib/api", () => {
  class MockApiError extends Error { status: number; constructor(status: number) { super("api error"); this.status = status; } }
  return { ApiError: MockApiError, tasks: { startTask: state.api.start, finishTaskEarly: state.api.finish, deleteTask: state.api.remove, listTasks: vi.fn() } };
});
vi.mock("@/components/page-kit", () => ({
  PageShell: ({ children }: any) => <main>{children}</main>,
  PageHeader: ({ title, description, actions }: any) => <header><h1>{title}</h1><p>{description}</p>{actions}</header>,
  EmptyState: ({ title, children, action }: any) => <div><h2>{title}</h2><p>{children}</p>{action}</div>,
}));
vi.mock("@/components/google-import-button", () => ({ GoogleImportButton: () => <button>Google import</button>, GoogleImportReminder: () => <div>Google reminder</div> }));
vi.mock("@/components/task-form-dialog", () => ({ TaskFormDialog: ({ open, onSaved }: any) => open ? <button onClick={() => onSaved(task({ id: state.savedId, title: "New task" }))}>Save task</button> : null }));

const SelectContext = createContext<{ value: string; change: (value: string) => void }>({ value: "", change: () => undefined });
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <SelectContext.Provider value={{ value, change: onValueChange }}><div data-select-value={value}>{children}{value === "deadline" && <button onClick={() => onValueChange("unknown-sort")}>Unknown sort</button>}</div></SelectContext.Provider>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: ({ children }: any) => { const context = useContext(SelectContext); return <span>{typeof children === "function" ? children(context.value) : children}</span>; },
  SelectContent: ({ children }: any) => { const context = useContext(SelectContext); return <div>{children}<button onClick={() => context.change("")}>Select empty</button></div>; },
  SelectItem: ({ value, children }: any) => { const context = useContext(SelectContext); return <button onClick={() => context.change(value)}>{children}</button>; },
}));
vi.mock("@/components/ui/popover", () => ({ Popover: ({ children }: any) => <div>{children}</div>, PopoverTrigger: ({ render }: any) => render, PopoverContent: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ render }: any) => render,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, render, onClick }: any) => render ?? <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: ({ open, confirmLabel, onConfirm, onOpenChange }: any) => open ? <><button onClick={() => void onConfirm()}>{confirmLabel}</button><button onClick={() => onOpenChange?.(false)}>Cancel task dialog</button></> : <button onClick={() => void onConfirm()}>Invoke {confirmLabel} with no target</button> }));

import { ApiError } from "@/lib/api";
import TasksPage from "./(app)/tasks/page";

beforeEach(() => {
  state.mode = "normal";
  state.params = new URLSearchParams();
  state.tasks = [task({ id: "task-new", title: "New assignment", status: "Not Started", priority: "Low", course: undefined }), task(), task({ id: "task-done", title: "Finished task", status: "Completed", remainingDuration: 0, priority: "Medium" }), task({ id: "task-overdue", title: "Overdue task", status: "Overdue", priority: "High", deadline: "2026-09-20T12:00:00Z" })];
  state.api.start.mockResolvedValue(undefined);
  state.api.finish.mockResolvedValue(undefined);
  state.api.remove.mockResolvedValue(undefined);
  state.savedId = "task-new";
  state.setDataNull = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("tasks page", () => {
  it("filters, sorts, edits, starts, finishes, and deletes tasks", async () => {
    render(<TasksPage />);
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    const search = screen.getByRole("searchbox", { name: "Search tasks by title" });
    fireEvent.change(search, { target: { value: "read" } });
    fireEvent.keyDown(search, { key: "Enter" });
    screen.getByRole("button", { name: "Remove “read” filter" }).click();
    fireEvent.change(search, { target: { value: "read" } });
    fireEvent.keyDown(search, { key: "Escape" });
    fireEvent.change(search, { target: { value: "read" } });
    screen.getByRole("button", { name: "Clear search" }).click();
    for (const label of ["Latest first", "Most work left", "Priority", "Name (A–Z)", "Soonest first"]) screen.getByRole("button", { name: label }).click();
    screen.getByRole("button", { name: /Filters/ }).click();
    screen.getAllByRole("button", { name: "Not Started" })[0].click();
    screen.getAllByRole("button", { name: "Assignment" })[0].click();
    screen.getAllByRole("button", { name: "High" })[0].click();
    const course = screen.getByPlaceholderText("Any course");
    fireEvent.change(course, { target: { value: "Algorithms" } });
    fireEvent.blur(course);
    fireEvent.keyDown(course, { key: "Enter" });
    fireEvent.keyDown(course, { key: "Escape" });
    fireEvent.change(screen.getByLabelText("Show tasks due before"), { target: { value: "2026-10-03T10:00" } });
    for (const label of ["Remove Not Started filter", "Remove Assignment filter", "Remove High priority filter", "Remove Algorithms filter", "Remove Due before set filter"]) {
      screen.getByRole("button", { name: label }).click();
    }
    screen.getByRole("button", { name: "Clear all filters" }).click();
    screen.getByRole("button", { name: "Unknown sort" }).click();
    screen.getByRole("button", { name: "Add task" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save task" })).toBeTruthy());
    screen.getByRole("button", { name: "Save task" }).click();

    const actionButtons = screen.getAllByRole("button", { name: /Actions for/ });
    actionButtons[0].click();
    screen.getAllByRole("button", { name: "Edit" })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save task" })).toBeTruthy());
    state.savedId = "task-added";
    screen.getByRole("button", { name: "Save task" }).click();
    screen.getAllByRole("button", { name: /Actions for New assignment/ })[0].click();
    screen.getAllByRole("button", { name: "Start" })[0].click();
    await waitFor(() => expect(state.api.start).toHaveBeenCalled());
    screen.getAllByRole("button", { name: /Actions for Read algorithms/ })[0].click();
    screen.getAllByRole("button", { name: "Finish early" })[0].click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark it finished" })).toBeTruthy());
    screen.getByRole("button", { name: "Cancel task dialog" }).click();
    screen.getAllByRole("button", { name: /Actions for Read algorithms/ })[0].click();
    screen.getByRole("button", { name: "Finish early" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark it finished" })).toBeTruthy());
    screen.getByRole("button", { name: "Mark it finished" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Invoke Mark it finished with no target" })).toBeTruthy());
    screen.getByRole("button", { name: "Invoke Mark it finished with no target" }).click();
    screen.getAllByRole("button", { name: /Actions for Finished task/ })[0].click();
    screen.getAllByRole("button", { name: "Delete" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Cancel task dialog" }).click();
    screen.getAllByRole("button", { name: /Actions for Finished task/ })[0].click();
    screen.getAllByRole("button", { name: "Delete" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete task" }).click();
    await waitFor(() => expect(state.api.remove).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Invoke Delete task with no target" })).toBeTruthy());
    screen.getByRole("button", { name: "Invoke Delete task with no target" }).click();
  });

  it("covers loading, error, empty/filter-empty, and action failures", async () => {
    state.mode = "loading";
    render(<TasksPage />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    cleanup();
    state.mode = "error";
    render(<TasksPage />);
    expect(screen.getByText("Could not load your tasks")).toBeTruthy();
    cleanup();
    state.tasks = [];
    render(<TasksPage />);
    expect(screen.getByText("No tasks yet")).toBeTruthy();
    cleanup();
    state.tasks = [task()];
    state.params = new URLSearchParams("search=nomatch");
    render(<TasksPage />);
    expect(screen.getByText("No tasks match these filters")).toBeTruthy();
    cleanup();
  state.tasks = [task({ status: "In Progress" })];
  state.params = new URLSearchParams();
  state.mode = "normal";
    state.api.finish.mockRejectedValueOnce(new ApiError(409, "conflict"));
    render(<TasksPage />);
    screen.getAllByRole("button", { name: /Actions for/ })[0].click();
    screen.getByRole("button", { name: "Finish early" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark it finished" })).toBeTruthy());
    screen.getByRole("button", { name: "Mark it finished" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("Start the task before finishing it early."));
  });

  it("executes every sort comparator and restores optimistic actions on ordinary errors", async () => {
    state.tasks = [
      task({ id: "a", title: "Alpha", status: "Not Started", priority: "High", remainingDuration: 10, deadline: "2026-10-02T12:00:00Z" }),
      task({ id: "b", title: "Beta", priority: "Low", remainingDuration: 50, deadline: "2026-10-01T12:00:00Z" }),
      task({ id: "c", title: "Gamma", priority: "High", remainingDuration: 30, deadline: "2026-10-03T12:00:00Z" }),
    ];
    render(<TasksPage />);
    const sort = screen.getByRole("button", { name: "Soonest first" });
    for (const label of ["Latest first", "Most work left", "Priority", "Name (A–Z)", "Soonest first"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(sort).toBeTruthy());
    }

    let resolveStart!: () => void;
    state.api.start.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    screen.getAllByRole("button", { name: /Actions for Alpha/ })[0].click();
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => expect(state.api.start).toHaveBeenCalled());
    screen.getByRole("button", { name: "Start" }).click();
    resolveStart();
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith("Task started"));

    state.api.start.mockRejectedValueOnce(new Error("start failed"));
    screen.getAllByRole("button", { name: /Actions for Alpha/ })[0].click();
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("start failed"));
  });

  it("covers filtered action removal branches and empty select values", async () => {
    state.tasks = [task({ id: "active", title: "Active", status: "In Progress" }), task({ id: "pending", title: "Pending", status: "Not Started" })];
    render(<TasksPage />);
    screen.getByRole("button", { name: "Filters" }).click();
    screen.getAllByRole("button", { name: "In Progress" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: /Actions for Active/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Actions for Active/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finish early" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark it finished" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Mark it finished" }));
    await waitFor(() => expect(state.api.finish).toHaveBeenCalled());

    cleanup();
    state.tasks = [task({ id: "pending", title: "Pending", status: "Not Started" })];
    render(<TasksPage />);
    screen.getByRole("button", { name: "Filters" }).click();
    screen.getAllByRole("button", { name: "Not Started" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: /Actions for Pending/ })).toBeTruthy());
    screen.getByRole("button", { name: /Actions for Pending/ }).click();
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => expect(state.api.start).toHaveBeenCalled());

    screen.getByRole("button", { name: /Filters/ }).click();
    for (const empty of screen.getAllByRole("button", { name: "Select empty" })) fireEvent.click(empty);
    fireEvent.click(screen.getAllByRole("button", { name: "Any status" }).at(-1)!);
  });

  it("restores optimistic state when the cache callback has no current list", async () => {
    state.tasks = [task({ id: "recoverable", title: "Recoverable", status: "Not Started" })];
    state.api.start.mockRejectedValueOnce(new Error("start failed without a list"));
    render(<TasksPage />);
    state.setDataNull = true;
    screen.getByRole("button", { name: /Actions for Recoverable/ }).click();
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("start failed without a list"));

    cleanup();
    state.setDataNull = false;
    state.tasks = [task({ id: "stale", title: "Stale row", status: "Not Started" })];
    state.api.start.mockRejectedValueOnce(new Error("stale row failed"));
    render(<TasksPage />);
    state.tasks.splice(0);
    screen.getByRole("button", { name: /Actions for Stale row/ }).click();
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("stale row failed"));
  });
});
