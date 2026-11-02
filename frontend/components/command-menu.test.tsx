// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandMenuProvider, ShortcutsDialog, useCommandMenu, useModifierKey } from "./command-menu";
import { TopBar } from "./top-bar";
import { TooltipProvider } from "./ui/tooltip";
import type { AcademicTask } from "@/types/task";
import { getFocusTimerState, resetFocusTimerStore } from "@/lib/focus-timer";

type Load = (signal: AbortSignal) => unknown;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: { current: "/dashboard" as string | null },
  useApi: vi.fn(),
  useTheme: vi.fn(),
  searchTasks: vi.fn(),
  applyTheme: vi.fn(),
  restartOnboarding: vi.fn(),
  toastSuccess: vi.fn(),
  lastLoad: { current: null as Load | null },
  closeMenu: { current: null as ((open: boolean) => void) | null },
  searchState: { current: { data: undefined as AcademicTask[] | undefined, isLoading: false } },
}));

vi.mock("next/navigation", () => {
  const router = { push: mocks.push, replace: vi.fn(), refresh: vi.fn() };
  return { usePathname: () => mocks.pathname.current, useRouter: () => router };
});
vi.mock("next-themes", () => ({ useTheme: mocks.useTheme }));
vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi, describeError: (error: unknown) => String(error) }));
vi.mock("@/lib/api", () => ({ tasks: { searchTasks: mocks.searchTasks } }));
vi.mock("@/lib/theme", () => ({ applyThemeWithTransition: mocks.applyTheme }));
vi.mock("@/lib/onboarding", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  restartOnboarding: mocks.restartOnboarding,
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }));
vi.mock("@/components/ui/dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/dialog")>();
  function Dialog(props: React.ComponentProps<typeof actual.Dialog>) {
    // The command menu passes its local `close` function; keep it so tests can reopen through it.
    if (props.onOpenChange?.name === "close") mocks.closeMenu.current = props.onOpenChange as (open: boolean) => void;
    return <actual.Dialog {...props} />;
  }
  return { ...actual, Dialog };
});
vi.mock("@/components/task-form-dialog", () => ({
  TaskFormDialog: ({
    open,
    onOpenChange,
    onSaved,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: (task: { id: string; title: string }) => void;
  }) =>
    open ? (
      <div data-testid="task-form">
        <button type="button" onClick={() => onSaved({ id: "t1", title: "New" })}>Save task</button>
        <button type="button" onClick={() => onOpenChange(false)}>Close task form</button>
      </div>
    ) : null,
}));

const task = (overrides: Partial<AcademicTask> = {}): AcademicTask => ({
  id: "task-1", title: "Read chapter", category: "Reading", deadline: "2099-09-15T12:00:00Z",
  priority: "High", originalEstimate: 120, plannedSource: "Original", plannedDuration: 120,
  actualDuration: 20, remainingDuration: 100, status: "In Progress", sessionsCompleted: 1,
  sessionsUpcoming: 2, createdAt: "2099-09-01T00:00:00Z", updatedAt: "2099-09-01T00:00:00Z", ...overrides,
});

function renderProvider(children: React.ReactNode = <p>page</p>) {
  return render(
    <TooltipProvider>
      <CommandMenuProvider>{children}</CommandMenuProvider>
    </TooltipProvider>,
  );
}

const input = () => screen.getByRole("combobox", { name: "Search tasks, pages and actions" });
const option = (name: RegExp) => screen.getByRole("option", { name });
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });

async function openMenu() {
  press("k", { ctrlKey: true });
  await screen.findByPlaceholderText("Search tasks, pages and actions…");
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.localStorage.clear();
  mocks.pathname.current = "/dashboard";
  mocks.searchState.current = { data: undefined, isLoading: false };
  mocks.useTheme.mockReturnValue({ theme: "dark", setTheme: vi.fn() });
  mocks.useApi.mockImplementation((key: unknown, load: Load) => {
    mocks.lastLoad.current = load;
    return key ? mocks.searchState.current : { data: undefined, isLoading: false };
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useCommandMenu and useModifierKey", () => {
  it("falls back to no-op handlers outside the provider", () => {
    render(<TooltipProvider><TopBar /></TooltipProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Search tasks, pages and actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a task" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    function Probe() {
      const api = useCommandMenu();
      api.openShortcuts();
      return <span>{useModifierKey()}</span>;
    }
    const probe = render(<Probe />);
    expect(probe.container.textContent).toBe("Ctrl");
  });

  it("shows where you are as a breadcrumb", () => {
    const crumbs = () => Array.from(screen.getByRole("navigation", { name: "Breadcrumb" }).querySelectorAll("li")).map((li) => li.textContent);
    const view = render(<TooltipProvider><TopBar /></TooltipProvider>);
    expect(crumbs()).toEqual(["StudyFlow", "/Dashboard"]);
    expect(screen.getByText("Dashboard").getAttribute("aria-current")).toBe("page");

    mocks.pathname.current = "/tasks/abc";
    view.rerender(<TooltipProvider><TopBar /></TooltipProvider>);
    expect(crumbs()).toEqual(["StudyFlow", "/Tasks", "/Task"]);
    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("href")).toBe("/tasks");

    mocks.pathname.current = "/import/google";
    view.rerender(<TooltipProvider><TopBar /></TooltipProvider>);
    expect(crumbs()).toEqual(["StudyFlow", "/Import", "/Google"]);

    mocks.pathname.current = "/unknown";
    view.rerender(<TooltipProvider><TopBar /></TooltipProvider>);
    expect(crumbs()).toEqual(["StudyFlow"]);

    mocks.pathname.current = null;
    view.rerender(<TooltipProvider><TopBar /></TooltipProvider>);
    expect(crumbs()).toEqual(["StudyFlow"]);
  });

  it("uses Ctrl on the server and the command key on Apple devices", () => {
    expect(renderToString(<TooltipProvider><TopBar /></TooltipProvider>)).toContain("Ctrl");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    render(<ShortcutsDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText("⌘")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Anywhere" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Go to" })).toBeNull();
  });
});

describe("TopBar inside the provider", () => {
  it("opens the menu and the task form from its buttons", async () => {
    renderProvider(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "Search tasks, pages and actions" }));
    expect(await screen.findByPlaceholderText("Search tasks, pages and actions…")).toBeTruthy();
    press("k", { metaKey: true });
    await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Add a task" }));
    expect(screen.getByTestId("task-form")).toBeTruthy();
    fireEvent.click(screen.getByText("Save task"));
    const [title, options] = mocks.toastSuccess.mock.calls[0];
    expect(title).toBe("Task added");
    expect(options.description).toBe("New");
    options.action.onClick();
    expect(mocks.push).toHaveBeenCalledWith("/tasks/t1");
    fireEvent.click(screen.getByText("Close task form"));
    expect(screen.queryByTestId("task-form")).toBeNull();
  });
});

describe("global keyboard shortcuts", () => {
  it("opens the menu, task form and shortcut sheet from single keys", async () => {
    renderProvider();
    press("/");
    expect(await screen.findByPlaceholderText("Search tasks, pages and actions…")).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());

    press("n");
    expect(screen.getByTestId("task-form")).toBeTruthy();
    fireEvent.click(screen.getByText("Close task form"));

    press("?");
    expect(await screen.findByText("Keyboard shortcuts")).toBeTruthy();
  });

  it("ignores prevented, repeated, modified, blocked and unknown keys", () => {
    renderProvider(<input aria-label="field" />);
    const prevented = new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true });
    prevented.preventDefault();
    window.dispatchEvent(prevented);
    press("n", { repeat: true });
    press("n", { ctrlKey: true });
    press("n", { metaKey: true });
    press("n", { altKey: true });
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "n" });
    press("x");
    expect(screen.queryByTestId("task-form")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open the command menu while another dialog is open", async () => {
    renderProvider();
    press("?");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    press("k", { ctrlKey: true });
    press("k", { metaKey: true });
    expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();

    cleanup();
    renderProvider(
      <div role="alertdialog" data-open aria-label="Delete your account?">
        Delete your account?
      </div>,
    );
    press("k", { ctrlKey: true });
    expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull();
    expect(screen.getByRole("alertdialog", { name: "Delete your account?" })).toBeTruthy();
  });

  it("has no G-sequence page shortcuts", () => {
    renderProvider();
    press("g");
    press("d");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("command menu", () => {
  it("searches tasks and opens a match or every match", async () => {
    mocks.searchState.current = {
      data: [task({ id: "t1", title: "Read chapter", course: "History" }), task({ id: "t2", title: "Read notes", course: undefined })],
      isLoading: false,
    };
    renderProvider();
    await openMenu();
    expect(mocks.lastLoad.current).not.toBeNull();

    fireEvent.change(input(), { target: { value: "read" } });
    expect(await screen.findByText("History")).toBeTruthy();
    const signal = new AbortController().signal;
    mocks.lastLoad.current?.(signal);
    expect(mocks.searchTasks).toHaveBeenCalledWith("read", signal, 8);

    fireEvent.click(option(/Read chapter/));
    expect(mocks.push).toHaveBeenCalledWith("/tasks/t1");
    await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());

    await openMenu();
    expect((input() as HTMLInputElement).value).toBe("");
    fireEvent.change(input(), { target: { value: "read" } });
    fireEvent.click(await screen.findByRole("option", { name: /See every match in Tasks/ }));
    expect(mocks.push).toHaveBeenCalledWith("/tasks?search=read");
  });

  it("opens the task whose full title was typed when Enter is pressed", async () => {
    mocks.searchState.current = {
      data: [task({ id: "t1", title: "Calendar notes" }), task({ id: "t2", title: "Calendar" })],
      isLoading: false,
    };
    renderProvider();
    await openMenu();
    fireEvent.change(input(), { target: { value: "calendar" } });
    await waitFor(() => expect(document.querySelector('[cmdk-item][data-value="task-t2"]')?.getAttribute("aria-selected")).toBe("true"));
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledWith("/tasks/t2");
  });

  it("shows searching and empty states", async () => {
    renderProvider();
    await openMenu();
    fireEvent.change(input(), { target: { value: "zzzz" } });
    expect(screen.getByText("Searching…")).toBeTruthy();
    expect(await screen.findByText("Nothing matches “zzzz”.")).toBeTruthy();

    mocks.searchState.current = { data: undefined, isLoading: true };
    fireEvent.change(input(), { target: { value: "zzzzy" } });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getByText("Searching…")).toBeTruthy();
  });

  it("runs actions, navigation, help and reopens through its own change handler", async () => {
    renderProvider();
    const cases: [RegExp, string][] = [
      [/^Plan my time/, "/calendar"],
      [/^Set my study hours/, "/availability"],
      [/^Tasks/, "/tasks"],
    ];
    for (const [name, href] of cases) {
      await openMenu();
      fireEvent.click(option(name));
      expect(mocks.push).toHaveBeenLastCalledWith(href);
      await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());
    }

    await openMenu();
    fireEvent.click(option(/^Show getting started/));
    expect(mocks.restartOnboarding).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());

    await openMenu();
    fireEvent.click(option(/^Add a task/));
    expect(screen.getByTestId("task-form")).toBeTruthy();
    fireEvent.click(screen.getByText("Close task form"));
    await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());

    await openMenu();
    fireEvent.click(option(/^Keyboard shortcuts/));
    expect(await screen.findByRole("region", { name: "Anywhere" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull();

    act(() => mocks.closeMenu.current?.(true));
    expect(await screen.findByPlaceholderText("Search tasks, pages and actions…")).toBeTruthy();
  });

  it("starts, pauses and resumes the focus timer", async () => {
    resetFocusTimerStore();
    renderProvider();
    for (const [name, status] of [
      [/^Start focus timer/, "running"],
      [/^Pause focus timer/, "paused"],
      [/^Resume focus timer/, "running"],
    ] as const) {
      await openMenu();
      fireEvent.click(option(name));
      expect(getFocusTimerState().status).toBe(status);
      await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());
    }
    resetFocusTimerStore();
  });

  it("switches themes and density", async () => {
    const setTheme = vi.fn();
    mocks.useTheme.mockReturnValue({ theme: undefined, setTheme });
    renderProvider();
    await openMenu();
    expect(option(/^Match my device theme/).getAttribute("data-checked")).toBe("true");
    expect(option(/^Dark theme/).getAttribute("data-checked")).toBeNull();
    fireEvent.click(option(/^Dark theme/));
    expect(mocks.applyTheme).toHaveBeenCalledWith("dark", setTheme);
    await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());

    await openMenu();
    fireEvent.click(option(/^Use compact spacing/));
    expect(document.documentElement.dataset.density).toBe("compact");
    await waitFor(() => expect(screen.queryByPlaceholderText("Search tasks, pages and actions…")).toBeNull());

    await openMenu();
    fireEvent.click(option(/^Use comfortable spacing/));
    expect(document.documentElement.dataset.density).toBeUndefined();
  });
});
