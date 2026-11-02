// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookOpen } from "@/components/icons";

const state = vi.hoisted(() => ({
  pathname: "/dashboard",
  account: { name: "Ada Lovelace", email: "ada@example.com", avatarUrl: undefined } as { name: string; email: string; avatarUrl?: string } | null,
  signOut: vi.fn(),
  openShortcuts: vi.fn(),
  restartOnboarding: vi.fn(),
  startProductTour: vi.fn(),
  getPendingRevision: vi.fn(),
  listTasks: vi.fn(),
  getActiveSchedule: vi.fn(),
  revision: { data: undefined, error: undefined, isLoading: false } as { data?: unknown; error?: unknown; isLoading: boolean },
  tasks: { data: undefined, error: undefined, isLoading: false } as { data?: unknown; error?: unknown; isLoading: boolean },
  schedule: { data: undefined, error: undefined, isLoading: false } as { data?: unknown; error?: unknown; isLoading: boolean },
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} onClick={(event) => { event.preventDefault(); props.onClick?.(event); }}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ status: "authenticated", account: state.account, signOut: state.signOut }) }));
vi.mock("@/components/command-menu", () => ({
  CommandMenuProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCommandMenu: () => ({ openShortcuts: state.openShortcuts, open: vi.fn() }),
  useModifierKey: () => "Ctrl",
}));
vi.mock("@/components/top-bar", () => ({ TopBar: () => <div>top bar</div> }));
vi.mock("@/components/theme-selector", () => ({ ThemeSelector: () => <div>theme selector</div> }));
vi.mock("@/lib/onboarding", () => ({ restartOnboarding: state.restartOnboarding, startProductTour: state.startProductTour }));
vi.mock("@/components/onboarding", () => ({ SidebarGuide: () => <div>getting started guide</div> }));
vi.mock("@/components/product-tour", () => ({ ProductTour: () => <div>product tour</div> }));
vi.mock("@/lib/api", () => ({
  scheduling: { getPendingRevision: state.getPendingRevision, getActiveSchedule: state.getActiveSchedule },
  tasks: { listTasks: state.listTasks },
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: (key: unknown, loader: (signal: AbortSignal) => unknown) => {
    loader(new AbortController().signal);
    if (key === "studyflow/schedule/pending-revision") return state.revision;
    if (key === "studyflow/tasks") return state.tasks;
    return state.schedule;
  },
}));

import { SidebarProvider } from "@/components/ui/sidebar";
import DashboardShell from "./app-sidebar";
import { NavMain } from "./nav-main";
import NotificationDropdown from "./notification-dropdown";
import UserDropdown from "./user-dropdown";
import { resetSeenReminders } from "@/lib/reminders";

function stubViewport(mobile: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

function openMenu(name: string | RegExp) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  stubViewport(false);
  state.pathname = "/dashboard";
  state.account = { name: "Ada Lovelace", email: "ada@example.com", avatarUrl: undefined };
  state.revision = { data: undefined, error: undefined, isLoading: false };
  state.tasks = { data: undefined, error: undefined, isLoading: false };
  state.schedule = { data: undefined, error: undefined, isLoading: false };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("dashboard shell", () => {
  it("renders navigation, header and content on desktop and collapses", () => {
    render(<DashboardShell><p>page body</p></DashboardShell>);
    expect(screen.getByText("page body")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main-content");
    expect(screen.getByRole("main").id).toBe("main-content");
    expect(screen.getByText("top bar")).toBeTruthy();
    expect(state.getPendingRevision).toHaveBeenCalled();
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard.getAttribute("aria-current")).toBe("page");
    expect(dashboard.getAttribute("aria-keyshortcuts")).toBeNull();
    expect(screen.getByText("getting started guide")).toBeTruthy();
    expect(screen.getByText("product tour")).toBeTruthy();
    expect(dashboard.getAttribute("data-tour")).toBe("nav-dashboard");
    fireEvent.click(dashboard);
    fireEvent.click(screen.getByRole("link", { name: "StudyFlow home" }));

    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    const expand = screen.getByRole("button", { name: "Expand navigation" });
    expect(screen.queryByRole("link", { name: "StudyFlow home" })).toBeNull();
    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeTruthy();
  });

  it("closes the mobile drawer when navigating", () => {
    stubViewport(true);
    state.pathname = "/tasks/123";
    render(<DashboardShell><p>page body</p></DashboardShell>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("link", { name: "StudyFlow home" }));
  });
});

describe("nav main", () => {
  it("skips incomplete items and renders items without icons or shortcuts", () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <NavMain items={[{ label: "Group", isSection: true }, { title: "No link" }, { href: "/nowhere" }, { title: "Library", href: "/library", icon: BookOpen }, { title: "Plain", href: "/plain" }]} />
      </SidebarProvider>,
    );
    expect(screen.getByText("Group")).toBeTruthy();
    expect(screen.queryByText("No link")).toBeNull();
    const library = screen.getByRole("link", { name: "Library" });
    expect(library.getAttribute("aria-keyshortcuts")).toBeNull();
    expect(library.getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Plain" })).toBeTruthy();
  });
});

describe("user dropdown", () => {
  it("runs every menu action on desktop", async () => {
    render(<SidebarProvider><UserDropdown /></SidebarProvider>);
    expect(screen.getAllByText("AL").length).toBeGreaterThan(0);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    const pick = async (name: RegExp) => {
      openMenu("Account menu");
      fireEvent.click(await screen.findByRole("menuitem", { name }));
    };
    await pick(/My profile/);
    await pick(/Account settings/);
    await pick(/Take the tour/);
    expect(state.startProductTour).toHaveBeenCalled();
    await pick(/Show getting started/);
    expect(state.restartOnboarding).toHaveBeenCalled();
    await pick(/Keyboard shortcuts/);
    expect(state.openShortcuts).toHaveBeenCalled();
    await pick(/Sign out/);
    expect(state.signOut).toHaveBeenCalled();
  });

  it("closes the mobile drawer from menu actions", async () => {
    stubViewport(true);
    render(<SidebarProvider><UserDropdown /></SidebarProvider>);
    for (const name of [/My profile/, /Account settings/, /Take the tour/, /Show getting started/, /Keyboard shortcuts/]) {
      openMenu("Account menu");
      fireEvent.click(await screen.findByRole("menuitem", { name }));
    }
    expect(state.openShortcuts).toHaveBeenCalled();
  });

  it("falls back when there is no account and when collapsed", () => {
    state.account = null;
    render(<SidebarProvider><UserDropdown /></SidebarProvider>);
    expect(screen.getAllByText("?").length).toBeGreaterThan(0);
    expect(screen.getByText("My account")).toBeTruthy();
    cleanup();

    render(<SidebarProvider defaultOpen={false}><UserDropdown /></SidebarProvider>);
    expect(screen.getByRole("button", { name: "Account menu" }).getAttribute("title")).toBe("Account menu");
    cleanup();

    state.account = { name: "Grace Hopper", email: "grace@example.com" };
    render(<SidebarProvider defaultOpen={false}><UserDropdown /></SidebarProvider>);
    expect(screen.getByRole("button", { name: "Account menu" }).getAttribute("title")).toBe("Grace Hopper");
  });
});

describe("notification dropdown", () => {
  const cases: Array<[typeof state.revision, string]> = [
    [{ isLoading: true }, "Checking your plan…"],
    [{ isLoading: false, error: new Error("x") }, "Could not check your plan. Open the calendar to try again."],
    [{ isLoading: false, data: { id: "r1" } }, "A new plan is ready to review"],
    [{ isLoading: false }, "You are all caught up."],
  ];
  beforeEach(() => resetSeenReminders());

  it.each(cases)("shows the %o state", async (revision, text) => {
    state.revision = revision;
    render(<NotificationDropdown />);
    await act(async () => { openMenu(/^Study reminders/); });
    expect(await screen.findByText(text)).toBeTruthy();
  });

  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const overdueTask = (id: string, hours: number) => ({ id, title: `Task ${id}`, status: "Overdue", deadline: hoursAgo(hours) });
  const awaitingSession = (id: string, hours: number) => ({ id, taskTitle: `Session ${id}`, isAwaitingOutcome: true, endTime: hoursAgo(hours) });

  it("lists each reminder and clears the dot once the menu has been opened", async () => {
    state.tasks = { isLoading: false, data: [overdueTask("t1", 50), overdueTask("t2", 3), { id: "t3", title: "Open", status: "Not Started", deadline: hoursAgo(-5) }] };
    state.schedule = { isLoading: false, data: { sessions: [awaitingSession("s1", 2), { id: "s2", taskTitle: "Done", isAwaitingOutcome: false, endTime: hoursAgo(1) }] } };
    render(<NotificationDropdown />);
    expect(state.listTasks).toHaveBeenCalled();
    expect(state.getActiveSchedule).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Study reminders, 3 new" })).toBeTruthy();
    expect(screen.getByTestId("reminder-dot")).toBeTruthy();

    await act(async () => { openMenu(/^Study reminders/); });
    expect(await screen.findByText("How did “Session s1” go?")).toBeTruthy();
    expect(screen.getByText("Task t1 is overdue").closest("a")?.getAttribute("href")).toBe("/tasks/t1");
    expect(screen.getByText(/Due 2 days ago/)).toBeTruthy();
    expect(screen.getAllByLabelText("New")).toHaveLength(3);
    expect(screen.queryByText("You are all caught up.")).toBeNull();
    expect(screen.queryByTestId("reminder-dot")).toBeNull();
    cleanup();

    render(<NotificationDropdown />);
    expect(screen.getByRole("button", { name: "Study reminders" })).toBeTruthy();
    await act(async () => { openMenu(/^Study reminders/); });
    expect(await screen.findByText("Task t2 is overdue")).toBeTruthy();
    expect(screen.queryByLabelText("New")).toBeNull();
  });

  it("caps the list and counts the rest", async () => {
    state.revision = { isLoading: false, data: { id: "r1" } };
    state.tasks = { isLoading: false, data: [1, 2, 3, 4, 5, 6].map((n) => overdueTask(`t${n}`, n)) };
    state.schedule = { isLoading: false, data: { sessions: [awaitingSession("s1", 0.2), awaitingSession("s2", 30)] } };
    render(<NotificationDropdown />);
    await act(async () => { openMenu(/^Study reminders/); });
    expect(await screen.findByText("And 4 more.")).toBeTruthy();
    expect(screen.getByText(/ended 12m ago/)).toBeTruthy();
    expect(screen.getByText(/ended 1 day ago/)).toBeTruthy();
  });
});
