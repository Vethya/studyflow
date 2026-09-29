// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GettingStarted, WelcomeTour } from "./onboarding";
import { rememberWelcomeSeen, restartOnboarding } from "@/lib/onboarding";

beforeEach(() => {
  localStorage.clear();
  restartOnboarding();
});
afterEach(cleanup);

describe("onboarding surfaces", () => {
  it("uses the server snapshots and resets when a dismissal is cleared", () => {
    expect(renderToString(<WelcomeTour state={{ weeklyWindows: 0, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }} ready />)).toBe("");
    expect(renderToString(<GettingStarted state={{ weeklyWindows: 1, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }} ready />)).toBe("");
    rememberWelcomeSeen();
    const { rerender } = render(<WelcomeTour state={{ weeklyWindows: 0, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }} ready />);
    restartOnboarding();
    rerender(<WelcomeTour state={{ weeklyWindows: 0, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }} ready />);
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
  });

  it("walks through, goes back, and closes the welcome tour", () => {
    render(<WelcomeTour state={{ weeklyWindows: 0, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }} ready />);
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByText("Step 2 of 4")).toBeNull();
  });

  it("renders the final tour action and checklist visibility states", () => {
    render(<WelcomeTour state={{ weeklyWindows: 0, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }} ready />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Set my hours" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set my hours" }));

    const { rerender } = render(<GettingStarted state={{ weeklyWindows: 1, openTasks: 0, plannedSessions: 0, recordedOutcomes: 1 }} ready />);
    expect(screen.getByText("Getting started")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Getting started")).toBeNull();
    rerender(<GettingStarted state={{ weeklyWindows: 1, openTasks: 1, plannedSessions: 1, recordedOutcomes: 1 }} ready />);
    expect(screen.queryByText("Getting started")).toBeNull();
    rerender(<GettingStarted state={{ weeklyWindows: 0, openTasks: 1, plannedSessions: 0, recordedOutcomes: 0 }} ready={false} />);
    expect(screen.queryByText("Getting started")).toBeNull();
  });
});
