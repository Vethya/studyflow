// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarGuide } from "./onboarding";
import { SidebarProvider } from "./ui/sidebar";
import { rememberGettingStartedHidden, restartOnboarding } from "@/lib/onboarding";
import { SWR_KEYS } from "@/lib/swr-keys";

interface Fixture {
  tasks: { status: string }[] | null;
  windows: unknown[] | null;
  /** `null` is a student with no plan yet: the API has no schedule to return. */
  sessions: { outcome?: string }[] | null;
  scheduleLoading?: boolean;
  error?: Error;
}

const { fixture, api } = vi.hoisted(() => ({
  fixture: { current: null as unknown as Fixture },
  api: {
    listTasks: vi.fn(async () => []),
    listWindows: vi.fn(async () => []),
    getActiveSchedule: vi.fn(async () => ({ sessions: [] })),
  },
}));

vi.mock("@/lib/api", () => ({
  tasks: { listTasks: api.listTasks },
  availability: { listWindows: api.listWindows },
  scheduling: { getActiveSchedule: api.getActiveSchedule },
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: (key: unknown, loader: (signal: AbortSignal) => Promise<unknown>) => {
    void loader(new AbortController().signal);
    const { tasks, windows, sessions, scheduleLoading = false, error } = fixture.current;
    if (key === SWR_KEYS.tasks) return { data: tasks, error: null, isLoading: tasks === null };
    if (key === SWR_KEYS.availabilityWindows) return { data: windows, error: error ?? null, isLoading: windows === null };
    return { data: sessions === null ? null : { sessions }, error: null, isLoading: scheduleLoading };
  },
}));

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

function renderGuide(defaultOpen = true) {
  return render(
    <SidebarProvider defaultOpen={defaultOpen}>
      <SidebarGuide />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  restartOnboarding();
  mobile.value = false;
  fixture.current = { tasks: [], windows: [{}], sessions: [] };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SidebarGuide", () => {
  it("stays out of the server render so it never flashes in", () => {
    expect(
      renderToString(
        <SidebarProvider>
          <SidebarGuide />
        </SidebarProvider>,
      ),
    ).not.toContain("Getting started");
  });

  it("lists the steps, marks the next one, and loads through the shared keys", () => {
    renderGuide();
    expect(screen.getByRole("heading", { name: "Getting started" })).toBeTruthy();
    expect(screen.getByText("1 of 4 done")).toBeTruthy();
    const next = screen.getByRole("link", { name: /Add your coursework/ });
    expect(next.getAttribute("aria-current")).toBe("step");
    expect(next.getAttribute("href")).toBe("/tasks");
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Next step")).toBeTruthy();
    expect(screen.getAllByText("Not done yet")).toHaveLength(2);
    expect(api.listTasks).toHaveBeenCalled();
    expect(api.listWindows).toHaveBeenCalled();
    expect(api.getActiveSchedule).toHaveBeenCalled();
    fireEvent.click(next);
  });

  it("shows every step to a brand-new student who has no schedule yet", () => {
    fixture.current = { tasks: [], windows: [], sessions: null };
    const { rerender } = renderGuide();
    expect(screen.getByRole("heading", { name: "Getting started" })).toBeTruthy();
    expect(screen.getByText("0 of 4 done")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Set the hours you can study/ }).getAttribute("aria-current")).toBe("step");

    fixture.current = { tasks: [], windows: [], sessions: null, scheduleLoading: true };
    rerender(<SidebarProvider><SidebarGuide /></SidebarProvider>);
    expect(screen.queryByText("Getting started")).toBeNull();
  });

  it("hides on request and comes back after a restart", () => {
    renderGuide();
    fireEvent.click(screen.getByRole("button", { name: "Hide getting started" }));
    expect(screen.queryByText("Getting started")).toBeNull();
    act(() => restartOnboarding());
    expect(screen.getByText("Getting started")).toBeTruthy();
  });

  it("disappears once every step is done, while loading, or on error", () => {
    fixture.current = {
      tasks: [{ status: "Not Started" }, { status: "Completed" }],
      windows: [{}],
      sessions: [{ outcome: "Completed" }, {}],
    };
    const { rerender } = renderGuide();
    expect(screen.queryByText("Getting started")).toBeNull();

    fixture.current = { tasks: null, windows: null, sessions: null };
    rerender(<SidebarProvider><SidebarGuide /></SidebarProvider>);
    expect(screen.queryByText("Getting started")).toBeNull();

    fixture.current = { tasks: [], windows: [], sessions: [], error: new Error("down") };
    rerender(<SidebarProvider><SidebarGuide /></SidebarProvider>);
    expect(screen.queryByText("Getting started")).toBeNull();

    fixture.current = { tasks: [], windows: [], sessions: [] };
    act(() => rememberGettingStartedHidden());
    rerender(<SidebarProvider><SidebarGuide /></SidebarProvider>);
    expect(screen.queryByText("Getting started")).toBeNull();
  });

  it("shrinks to a progress ring that links to the next step when collapsed", () => {
    renderGuide(false);
    const link = screen.getByRole("link", { name: /Getting started, 1 of 4 done\. Next: Add your coursework/ });
    expect(link.getAttribute("href")).toBe("/tasks");
  });

  it("closes the mobile sheet when a step is opened", () => {
    mobile.value = true;
    renderGuide();
    fireEvent.click(screen.getByRole("link", { name: /Set the hours you can study/ }));
    mobile.value = false;
  });
});
