import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardFocus } from "./dashboard-focus";

vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "Asia/Bangkok" }));
afterEach(cleanup);

function sessionAt(startTime: string) {
  const end = new Date(new Date(startTime).getTime() + 3_600_000).toISOString();
  return { id: "session-x", taskId: "task-1", taskTitle: "Write essay", category: "Assignment" as const, startTime, endTime: end, plannedDuration: 60, isAwaitingOutcome: false };
}

const base = { ready: true, hasWindows: true, openTasks: 2, pendingPlan: false, awaitingOutcome: 0, nextSession: null, onReview: vi.fn(), onRecord: vi.fn() };

describe("dashboard next action", () => {
  it("starts a new account with availability before suggesting a plan", () => {
    render(<DashboardFocus {...base} hasWindows={false} openTasks={0} />);
    expect(screen.getByRole("link", { name: "Set my study hours" }).getAttribute("href")).toBe("/availability");
    expect(screen.queryByRole("link", { name: "Plan my time" })).toBeNull();
  });

  it("directs an account with hours but no coursework to tasks", () => {
    render(<DashboardFocus {...base} openTasks={0} />);
    expect(screen.getByRole("link", { name: "Add a task" }).getAttribute("href")).toBe("/tasks");
  });

  it("opens the pending plan instead of generating another one", () => {
    const onReview = vi.fn();
    render(<DashboardFocus {...base} pendingPlan awaitingOutcome={2} onReview={onReview} />);
    fireEvent.click(screen.getByRole("button", { name: "Review my plan" }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("lets the student record outstanding outcomes", () => {
    const onRecord = vi.fn();
    render(<DashboardFocus {...base} awaitingOutcome={1} onRecord={onRecord} />);
    fireEvent.click(screen.getByRole("button", { name: "Record what happened" }));
    expect(onRecord).toHaveBeenCalledOnce();
  });

  it("uses the account timezone for the next session", () => {
    render(<DashboardFocus {...base} nextSession={{ id: "session-1", taskId: "task-1", taskTitle: "Read biology chapter", category: "Reading", startTime: "2026-10-02T03:00:00Z", endTime: "2026-10-02T04:00:00Z", plannedDuration: 60, isAwaitingOutcome: false }} />);
    expect(screen.getByRole("heading", { name: "Read biology chapter" })).toBeDefined();
    expect(screen.getByText(/10:00/)).toBeDefined();
    expect(screen.getByRole("link", { name: "View my session" }).getAttribute("href")).toBe("/calendar");
  });

  it("suggests planning after prerequisites are ready", () => {
    render(<DashboardFocus {...base} />);
    expect(screen.getByRole("link", { name: "Plan my time" }).getAttribute("href")).toBe("/calendar");
  });

  it("counts several sessions waiting on an outcome", () => {
    render(<DashboardFocus {...base} awaitingOutcome={2} />);
    expect(screen.getByText(/2 sessions need an update/)).toBeDefined();
  });

  it("does not count down when a pending plan takes priority over the next session", () => {
    render(<DashboardFocus {...base} pendingPlan nextSession={sessionAt("2026-10-01T03:00:00Z")} now={new Date("2026-10-01T03:00:00Z")} />);
    expect(screen.getByText("Your next step")).toBeDefined();
    expect(screen.queryByText("Starting now")).toBeNull();
  });

  it.each([
    ["2026-10-01T02:59:00Z", "Starting now"],
    ["2026-10-01T03:30:00Z", "In 30 min"],
    ["2026-10-01T06:00:00Z", /^Today at /],
    ["2026-10-02T03:00:00Z", /^Tomorrow at /],
  ])("counts down to a session starting at %s", (start, expected) => {
    render(<DashboardFocus {...base} nextSession={sessionAt(start)} now={new Date("2026-10-01T03:00:00Z")} />);
    expect(screen.getByText("Your next study session")).toBeDefined();
    expect(screen.getByText(expected)).toBeDefined();
  });

  it("omits the countdown for a session more than a day away", () => {
    const { container } = render(<DashboardFocus {...base} nextSession={sessionAt("2026-10-05T03:00:00Z")} now={new Date("2026-10-01T03:00:00Z")} />);
    expect(screen.getByText("Your next study session")).toBeDefined();
    expect(container.querySelector(".rounded-full.bg-primary\\/10")).toBeNull();
  });

  it("does not suggest an action until data is ready", () => {
    render(<DashboardFocus {...base} ready={false} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
