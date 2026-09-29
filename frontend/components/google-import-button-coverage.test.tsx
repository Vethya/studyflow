// @vitest-environment jsdom
import React, { createContext, useContext } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: { configured: true, calendarCheckedAt: null as string | null, classroomCheckedAt: null as string | null },
  now: new Date("2026-10-10T00:00:00Z"),
  calendar: vi.fn(), classroom: vi.fn(),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/hooks/use-api", () => ({ useApi: (_key: unknown, loader?: (signal: AbortSignal) => unknown) => { if (loader) void loader(new AbortController().signal); return { data: state.status, error: null, isLoading: false }; }, describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error" }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => state.now }));
vi.mock("@/lib/api", () => ({ googleImport: { getStatus: vi.fn(), startCalendarImport: state.calendar, startClassroomImport: state.classroom } }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children, onOpenChange }: any) => open ? <div role="dialog"><button onClick={() => onOpenChange?.(false)}>Close dialog</button>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogDescription: ({ children }: any) => <p>{children}</p>, DialogFooter: ({ children }: any) => <footer>{children}</footer>, DialogHeader: ({ children }: any) => <div>{children}</div>, DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
const SelectContext = createContext<(value: string) => void>(() => undefined);
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <SelectContext.Provider value={onValueChange}><div data-select={value}>{children}</div></SelectContext.Provider>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>, SelectValue: ({ children }: any) => <span>{typeof children === "function" ? children("28") : children}</span>, SelectContent: ({ children }: any) => <div>{children}</div>, SelectItem: ({ value, children }: any) => { const change = useContext(SelectContext); return <button onClick={() => change(value)}>{children}</button>; },
}));

import { GoogleImportButton, GoogleImportReminder, describeLastCheck } from "./google-import-button";

beforeEach(() => {
  state.status = { configured: true, calendarCheckedAt: null, classroomCheckedAt: null };
  state.now = new Date("2026-10-10T00:00:00Z");
  state.calendar.mockResolvedValue("/import/calendar");
  state.classroom.mockResolvedValue("/import/classroom");
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Google import controls", () => {
  it("formats check recency and covers hidden/configured import dialogs", async () => {
    expect(describeLastCheck(0)).toBe("today");
    expect(describeLastCheck(1)).toBe("yesterday");
    expect(describeLastCheck(6)).toBe("6 days ago");
    state.status.configured = false;
    render(<GoogleImportButton source="google_calendar" />);
    expect(screen.queryByText("Import from Google Calendar")).toBeNull();
    cleanup();
    state.status.configured = true;
    render(<GoogleImportButton source="google_calendar" />);
    screen.getByRole("button", { name: "Import from Google Calendar" }).click();
    await waitFor(() => expect(screen.getByText("Import busy time from Google Calendar")).toBeTruthy());
    screen.getByRole("button", { name: "Cancel" }).click();
    screen.getByRole("button", { name: "Import from Google Calendar" }).click();
    screen.getByRole("button", { name: "Close dialog" }).click();
    screen.getByRole("button", { name: "Import from Google Calendar" }).click();
    screen.getByRole("button", { name: "Next 4 weeks" }).click();
    screen.getByRole("button", { name: "Continue to Google" }).click();
    await waitFor(() => expect(state.calendar).toHaveBeenCalledWith(28));
    cleanup();
    state.calendar.mockImplementationOnce(() => new Promise(() => {}));
    render(<GoogleImportButton source="google_calendar" />);
    screen.getByRole("button", { name: "Import from Google Calendar" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue to Google" })).toBeTruthy());
    fireEvent.submit(screen.getByRole("button", { name: "Continue to Google" }).closest("form")!);
    fireEvent.submit(screen.getByRole("button", { name: "Continue to Google" }).closest("form")!);
    cleanup();
    state.calendar.mockRejectedValueOnce(new Error("calendar start failed"));
    render(<GoogleImportButton source="google_calendar" />);
    screen.getByRole("button", { name: "Import from Google Calendar" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue to Google" })).toBeTruthy());
    screen.getByRole("button", { name: "Continue to Google" }).click();
    await waitFor(() => expect(screen.getByText("calendar start failed")).toBeTruthy());
  });

  it("covers Classroom import and stale reminders", async () => {
    render(<GoogleImportButton source="google_classroom" variant="ghost" />);
    screen.getByRole("button", { name: "Import from Google Classroom" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue to Google" })).toBeTruthy());
    screen.getByRole("button", { name: "Continue to Google" }).click();
    await waitFor(() => expect(state.classroom).toHaveBeenCalled());
    cleanup();
    state.status.classroomCheckedAt = "2026-10-05T00:00:00Z";
    render(<GoogleImportReminder source="google_classroom" />);
    expect(screen.getByText(/Last checked Google Classroom 5 days ago/)).toBeTruthy();
    screen.getByRole("button", { name: "Check again" }).click();
    await waitFor(() => expect(screen.getByText("Import coursework from Google Classroom")).toBeTruthy());
    cleanup();
    state.status.classroomCheckedAt = null;
    render(<GoogleImportReminder source="google_classroom" />);
    expect(screen.queryByText(/Last checked/)).toBeNull();
    cleanup();
    state.status.calendarCheckedAt = "2026-10-09T00:00:00Z";
    render(<GoogleImportReminder source="google_calendar" />);
    expect(screen.queryByText(/Last checked/)).toBeNull();
    cleanup();
    state.status.calendarCheckedAt = "not-a-date";
    render(<GoogleImportReminder source="google_calendar" />);
    expect(screen.queryByText(/Last checked/)).toBeNull();
    cleanup();
    state.status = { configured: true, classroomCheckedAt: null } as any;
    render(<GoogleImportReminder source="google_calendar" />);
    expect(screen.queryByText(/Last checked/)).toBeNull();
  });
});
