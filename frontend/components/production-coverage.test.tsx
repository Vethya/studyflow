// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSWRConfig } from "swr";
import { CapacityBar } from "./capacity-bar";
import { AdaptiveEstimateNote, PersistedEstimateNote } from "./adaptive-estimate";
import { LegalPage, LegalSection } from "./legal-page";
import { OverloadWarningList } from "./overload-warning-list";
import { PageHeader, PageShell, SectionCard, SectionHeader, Figure, FigureRow, EmptyState } from "./page-kit";
import { ShortfallCard } from "./shortfall-card";
import { UnscheduledWorkList } from "./unscheduled-work-list";
import { WeekGrid, GridLegend } from "./week-grid";
import { DetailDrawer } from "./detail-drawer";
import { SessionDrawer } from "./session-drawer";
import { WelcomeTour, GettingStarted } from "./onboarding";
import { ThemeOptionIcon, ThemeSelector } from "./theme-selector";
import { ThemeProvider } from "./theme-provider";
import { TopBar } from "./top-bar";
import { StudyFlowSWRProvider } from "./swr-provider";
import { AppSidebar } from "./app-sidebar";
import { NavUser } from "./nav-user";
import { SidebarProvider } from "./ui/sidebar";
import { Button } from "./ui/button";
import type { AcademicTask } from "@/types/task";

const { useApiMock, useSessionMock, useThemeMock, searchTasksMock, signOutMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  useSessionMock: vi.fn(),
  useThemeMock: vi.fn(),
  searchTasksMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock, describeError: (error: unknown) => String(error) }));
vi.mock("@/hooks/use-session", () => ({ useSession: useSessionMock }));
vi.mock("next-themes", () => ({
  useTheme: useThemeMock,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/api", () => ({
  tasks: { searchTasks: searchTasksMock },
  googleImport: { getStatus: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const task = (overrides: Partial<AcademicTask> = {}): AcademicTask => ({
  id: "task-1", title: "Read chapter", category: "Reading", deadline: "2099-09-15T12:00:00Z",
  priority: "High", originalEstimate: 120, plannedSource: "Original", plannedDuration: 120,
  actualDuration: 20, remainingDuration: 100, status: "In Progress", sessionsCompleted: 1,
  sessionsUpcoming: 2, createdAt: "2099-09-01T00:00:00Z", updatedAt: "2099-09-01T00:00:00Z", ...overrides,
});

function SWRCacheProbe({ onReady }: { onReady: (value: { cache: Map<unknown, unknown> }) => void }) {
  const { cache } = useSWRConfig();
  React.useEffect(() => onReady({ cache: cache as Map<unknown, unknown> }), [cache, onReady]);
  return null;
}

beforeEach(() => {
  useApiMock.mockReturnValue({ data: undefined, error: null, isLoading: false });
  useSessionMock.mockReturnValue({ status: "authenticated", account: { id: "a", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: undefined }, signOut: signOutMock });
  useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
  signOutMock.mockResolvedValue(undefined);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("shared content components", () => {
  it("renders capacity, page-kit, legal, empty, and unscheduled states", () => {
    render(<div>
      <CapacityBar available={0} committed={30} />
      <CapacityBar available={100} committed={40} />
      <CapacityBar available={100} committed={110} />
      <CapacityBar available={100} committed={300} />
      <PageShell><PageHeader title="Header" description="Description" actions={<Button>Action</Button>} /><SectionHeader title="Section" meta="Meta" tone="deficit" action={{ href: "/tasks", label: "See all" }} /><SectionCard title="Card" description="Card description" action={<Button>Card action</Button>} footer="Footer" flush>Body</SectionCard><SectionCard title="Nonflush">Body</SectionCard><SectionCard>Body only</SectionCard><FigureRow><Figure label="A" value={null} /><Figure label="B" value="42" tone="surplus" hint="Hint" /><Figure label="C" value="0" tone="deficit" /></FigureRow><EmptyState title="Empty" icon={() => <span>Icon</span>} action={<Button>Fix</Button>}>Nothing here</EmptyState></PageShell>
      <LegalPage title="Privacy" intro="Intro"><LegalSection title="Section">Text</LegalSection></LegalPage>
      <UnscheduledWorkList items={[]} />
      <UnscheduledWorkList items={[{ taskId: "task-1", taskTitle: "Read chapter", remainingMinutes: 30, reason: "No room" }]} />
    </div>);
    expect(screen.getByText("Everything has a slot")).toBeTruthy();
    expect(screen.getByText("No room")).toBeTruthy();
    expect(screen.getByText("Privacy")).toBeTruthy();
  });

  it("renders overload warnings, shortfalls, and every week-grid state", () => {
    const click = vi.fn();
    const warning = { taskId: "task-1", taskTitle: "Read chapter", deadline: "2099-09-15T12:00:00Z", requiredMinutes: 120, availableMinutes: 30, shortfallMinutes: 90, remedies: ["extend_deadline", "add_availability"] as const, relevantUnavailablePeriods: [{ id: "p", startsAt: "2099-09-14T10:00:00Z", endsAt: "2099-09-14T11:00:00Z", reason: "Class" }] };
    const blocks = [
      { id: "available", columnKey: "mon", start: 9 * 60, end: 10 * 60, variant: "available" as const, title: "Free", onSelect: click },
      { id: "blocked", columnKey: "mon", start: 10 * 60, end: 10 * 60 + 10, variant: "blocked" as const, title: "Blocked", attention: true },
      { id: "proposed", columnKey: "mon", start: 11 * 60, end: 13 * 60, variant: "session" as const, title: "Proposed", label: "Proposed work", meta: "11:00", badge: "Proposed", tone: "proposed" as const, onSelect: click },
      { id: "missed", columnKey: "mon", start: 13 * 60, end: 15 * 60, variant: "session" as const, title: "Missed", label: "Missed work", badge: "Missed", tone: "missed" as const, settled: true },
      { id: "delayed", columnKey: "mon", start: 15 * 60, end: 17 * 60, variant: "session" as const, title: "Delayed", label: "Delayed work", badge: "Partly done", tone: "delayed" as const },
      { id: "completed", columnKey: "mon", start: 17 * 60, end: 19 * 60, variant: "session" as const, title: "Completed", label: "Completed work", badge: "Completed", tone: "completed" as const },
      { id: "default", columnKey: "mon", start: 19 * 60, end: 20 * 60, variant: "session" as const, title: "Default", label: "Default work", tone: "default" as const, badge: "Default" },
      { id: "untone", columnKey: "mon", start: 20 * 60, end: 21 * 60, variant: "session" as const, title: "Untoned", label: "Untoned work", badge: "Untoned" },
      { id: "settled-default", columnKey: "mon", start: 20 * 60, end: 21 * 60, variant: "session" as const, title: "Settled default", label: "Settled default", tone: "default" as const, settled: true },
    ];
    render(<div><OverloadWarningList warnings={[warning, { ...warning, taskId: "task-2", relevantUnavailablePeriods: [{ ...warning.relevantUnavailablePeriods[0], reason: undefined }] }]} /><ShortfallCard item={{ task: task(), deadline: new Date("2099-09-15T12:00:00Z"), requiredMinutes: 120, availableMinutes: 30, shortfallMinutes: 90, isOverloaded: true, relevantPeriods: [{ id: "p", title: "Class", startDate: "2099-09-14T10:00:00Z", endDate: "2099-09-14T11:00:00Z" }] }} /><ShortfallCard item={{ task: task({ deadline: "2026-09-01T00:00:00Z" }), deadline: new Date("2026-09-01T00:00:00Z"), requiredMinutes: 60, availableMinutes: 0, shortfallMinutes: 60, isOverloaded: true, relevantPeriods: [] }} /><ShortfallCard item={{ task: task(), deadline: new Date("2099-09-15T12:00:00Z"), requiredMinutes: 0, availableMinutes: 0, shortfallMinutes: 0, isOverloaded: false, relevantPeriods: [] }} /><WeekGrid columns={[{ key: "mon", label: "Mon", sublabel: "14", isToday: true }, { key: "tue", label: "Tue" }]} blocks={blocks} hourStart={8} hourEnd={21} now={{ columnKey: "mon", minutes: 12 * 60 }} renderLane={(column) => <span>{column.key}</span>} highlightedId="available" onHighlight={vi.fn()} /><GridLegend showDeadline showSession proposalStates={["proposed", "missed", "delayed", "completed"]} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Free" }));
    expect(screen.getAllByText("Extend deadline").length).toBeGreaterThan(0);
    expect(screen.getByText("Blocked by Class")).toBeTruthy();
  });

  it("covers zero-fill capacity, persisted estimate choices, and mobile drawers", () => {
    render(
      <div>
        <CapacityBar available={100} committed={0} />
        <AdaptiveEstimateNote estimate={{ category: "Assignment", originalEstimate: 60, adaptiveEstimate: 90, plannedDuration: 60, plannedSource: "Original", factor: 1.5, basedOnTasks: 2, isCategorySpecific: true }} />
        <PersistedEstimateNote originalEstimate={60} adaptiveEstimate={90} plannedDuration={60} plannedSource="Original" />
      </div>,
    );
    expect(screen.getAllByText(/your estimate/).length).toBeGreaterThan(0);
    cleanup();

    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<DetailDrawer open onOpenChange={vi.fn()} title="Desktop details">Body</DetailDrawer>);
    expect(screen.getByText("Desktop details")).toBeTruthy();
    cleanup();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<DetailDrawer open onOpenChange={vi.fn()} title="Mobile details">Body</DetailDrawer>);
    expect(screen.getByText("Mobile details")).toBeTruthy();
  });
});

describe("drawers, onboarding, themes, and navigation", () => {
  it("renders desktop and mobile detail/session drawer content", () => {
    const callbacks = { onOpenChange: vi.fn(), onEditTask: vi.fn(), onDeleteTask: vi.fn(), onRecordOutcome: vi.fn() };
    render(<DetailDrawer open onOpenChange={callbacks.onOpenChange} onOpenChangeComplete={callbacks.onOpenChange} title="Details" description="Description" footer={<Button>Footer</Button>}>Body</DetailDrawer>);
    expect(screen.getByText("Details")).toBeTruthy();
    cleanup();
    render(<div><SessionDrawer session={null} task={null} open={false} {...callbacks} /><SessionDrawer session={{ id: "s", taskId: "task-1", taskTitle: "Read chapter", category: "Reading", startTime: "2099-09-14T10:00:00Z", endTime: "2099-09-14T11:00:00Z", plannedDuration: 60, isAwaitingOutcome: true }} task={task()} open onOpenChange={callbacks.onOpenChange} onEditTask={callbacks.onEditTask} onDeleteTask={callbacks.onDeleteTask} onRecordOutcome={callbacks.onRecordOutcome} /></div>);
    expect(screen.getByText("This session is waiting on you")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record what happened" }));
    expect(callbacks.onRecordOutcome).toHaveBeenCalled();

    cleanup();
    render(<SessionDrawer session={{ id: "past", taskId: "task-1", taskTitle: "Past session", category: "Reading", startTime: "2026-09-14T10:00:00Z", endTime: "2026-09-14T11:00:00Z", plannedDuration: 60, isAwaitingOutcome: false }} task={null} open onOpenChange={callbacks.onOpenChange} onEditTask={callbacks.onEditTask} onDeleteTask={callbacks.onDeleteTask} onRecordOutcome={callbacks.onRecordOutcome} />);
    expect(screen.getByRole("button", { name: "Record what happened" })).toBeTruthy();

    cleanup();
    render(<SessionDrawer session={{ id: "done", taskId: "task-1", taskTitle: "Done session", category: "Reading", startTime: "2026-09-14T10:00:00Z", endTime: "2026-09-14T11:00:00Z", plannedDuration: 60, outcome: "Completed", actualDuration: 30, isAwaitingOutcome: false }} task={task({ deadline: "2026-09-01T00:00:00Z", priority: "High" })} open onOpenChange={callbacks.onOpenChange} onEditTask={callbacks.onEditTask} onDeleteTask={callbacks.onDeleteTask} onRecordOutcome={callbacks.onRecordOutcome} />);
    expect(screen.getByText("Finished")).toBeTruthy();
    expect(screen.getByText(/30m worked/)).toBeTruthy();

    cleanup();
    render(<SessionDrawer session={{ id: "done-zero", taskId: "task-1", taskTitle: "Done zero", category: "Reading", startTime: "2026-09-14T10:00:00Z", endTime: "2026-09-14T11:00:00Z", plannedDuration: 60, outcome: "Completed", actualDuration: 0, isAwaitingOutcome: false }} task={task()} open onOpenChange={callbacks.onOpenChange} onEditTask={callbacks.onEditTask} onDeleteTask={callbacks.onDeleteTask} onRecordOutcome={callbacks.onRecordOutcome} />);
    expect(screen.getByText("Done zero")).toBeTruthy();
  });

  it("renders onboarding tour/checklist states and theme selector", () => {
    render(<WelcomeTour state={{ weeklyWindows: 0, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }} ready />);
    expect(screen.getByText("Set the hours you can study")).toBeTruthy();
    cleanup();
    render(<SidebarProvider><div><GettingStarted state={{ weeklyWindows: 1, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }} ready /><ThemeOptionIcon theme="unknown" /><ThemeSelector /><ThemeProvider><span>Theme child</span></ThemeProvider></div></SidebarProvider>);
    expect(screen.getByText("Getting started")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByText("Theme child")).toBeTruthy();
    const theme = screen.getByRole("combobox", { name: "Theme" });
    fireEvent.mouseDown(theme);
    fireEvent.keyDown(theme, { key: "ArrowDown" });
    fireEvent.click(screen.getByText("AMOLED"));
  });

  it("renders sidebar account menu and exercises theme/sign-out actions", () => {
    render(<SidebarProvider><AppSidebar /><NavUser /></SidebarProvider>);
    expect(screen.getByText("StudyFlow")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Account menu" })[1]);
    fireEvent.click(screen.getByText("Appearance"));
    fireEvent.click(screen.getByText("Dark"));
    fireEvent.click(screen.getByText("Show me around"));
    fireEvent.click(screen.getAllByRole("button", { name: "Account menu" })[1]);
    fireEvent.click(screen.getByText("Settings"));
    fireEvent.click(screen.getAllByRole("button", { name: "Account menu" })[1]);
    fireEvent.click(screen.getByText("Log out"));
    expect(signOutMock).toHaveBeenCalled();

    cleanup();
    useSessionMock.mockReturnValue({ status: "unauthenticated", account: null, signOut: signOutMock });
    render(<SidebarProvider><NavUser /></SidebarProvider>);
    expect(screen.getAllByText("··").length).toBeGreaterThan(0);
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);

    cleanup();
    useSessionMock.mockReturnValue({ status: "authenticated", account: { id: "a", name: "A", email: "a@example.com" }, signOut: signOutMock });
    render(<SidebarProvider><NavUser /></SidebarProvider>);
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);

    cleanup();
    useSessionMock.mockReturnValue({ status: "authenticated", account: { id: "a", name: "   ", email: "a@example.com" }, signOut: signOutMock });
    render(<SidebarProvider><NavUser /></SidebarProvider>);
    expect(screen.getAllByText("?").length).toBeGreaterThan(0);

    cleanup();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    useSessionMock.mockReturnValue({ status: "authenticated", account: { id: "a", name: "Ada Lovelace", email: "ada@example.com" }, signOut: signOutMock });
    render(<SidebarProvider><NavUser /></SidebarProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("Appearance")).toBeTruthy();

    cleanup();
    useThemeMock.mockReturnValue({ theme: null, setTheme: vi.fn() });
    render(<SidebarProvider><NavUser /></SidebarProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByText("Appearance"));
    expect(screen.getByText("System")).toBeTruthy();
  });
});

describe("search and SWR coordination", () => {
  it("searches, clears, navigates, and displays empty results", async () => {
    searchTasksMock.mockResolvedValue([task({ id: "found", title: "Found task", course: "Math" })]);
    useApiMock.mockImplementationOnce((_key: unknown, load: (signal: AbortSignal) => Promise<unknown>) => {
      void load(new AbortController().signal);
      return { data: [task({ id: "found", title: "Found task", course: "Math" })], error: null, isLoading: false };
    });
    useApiMock.mockReturnValue({ data: [task({ id: "found", title: "Found task", course: "Math" })], error: null, isLoading: false });
    render(<TopBar />);
    const input = screen.getByLabelText("Find a task by title or course");
    fireEvent.change(input, { target: { value: "Found" } });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getByText("Found task")).toBeTruthy();
    fireEvent.click(screen.getByText("Found task"));
    fireEvent.change(input, { target: { value: "Found" } });
    await new Promise((resolve) => setTimeout(resolve, 250));
    fireEvent.click(screen.getByText("View all results in Tasks"));
    fireEvent.change(input, { target: { value: "clear me" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.change(input, { target: { value: "none" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("shows pending and empty search states", async () => {
    useApiMock.mockReturnValue({ data: [], error: null, isLoading: true });
    render(<TopBar />);
    const input = screen.getByLabelText("Find a task by title or course");
    fireEvent.change(input, { target: { value: "missing" } });
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
    useApiMock.mockReturnValue({ data: [], error: null, isLoading: false });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getByText(/No task matches/)).toBeTruthy();
  });

  it("covers empty search key handling and tasks without a course", async () => {
    useApiMock.mockReturnValue({ data: [task({ id: "no-course", title: "No course task", course: undefined })], error: null, isLoading: false });
    render(<TopBar />);
    const input = screen.getByLabelText("Find a task by title or course");
    fireEvent.change(input, { target: { value: "No course" } });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getByText("No course task")).toBeTruthy();
    expect(screen.queryByText(/Reading ·/)).toBeNull();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Tab" });

    cleanup();
    useApiMock.mockReturnValue({ data: null, error: null, isLoading: false });
    render(<TopBar />);
    fireEvent.change(screen.getByLabelText("Find a task by title or course"), { target: { value: "missing" } });
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  it("mounts the shared SWR provider and responds to mutation events", async () => {
    let cache: Map<unknown, unknown> | undefined;
    render(<StudyFlowSWRProvider><SWRCacheProbe onReady={(value) => { cache = value.cache; }} /><span>App</span></StudyFlowSWRProvider>);
    await waitFor(() => expect(cache).toBeDefined());
    cache!.set(["studyflow/tasks", "filtered"], []);
    cache!.set("studyflow/tasks", []);
    cache!.set(42, []);
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/tasks/1", method: "PUT" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/integrations/google/imports/1/classroom", method: "POST" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/integrations/google/imports/1/calendar", method: "POST" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/availability/windows", method: "PUT" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/account/profile", method: "PUT" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/account/password", method: "PUT" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/account/preferences", method: "PUT" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/account/identities", method: "PUT" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/account/deletion/status", method: "GET" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/adaptive-estimates/Reading", method: "POST" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/schedule-proposals", method: "POST" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/schedule-proposals/1/reject", method: "POST" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/schedule-proposals/1/accept", method: "POST" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/study-sessions/1/outcome", method: "POST" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path: "/unknown-endpoint", method: "POST" } }));
    window.dispatchEvent(new CustomEvent("studyflow:data-changed"));
    await waitFor(() => expect(screen.getByText("App")).toBeTruthy());
  });
});
