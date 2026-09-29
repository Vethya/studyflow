// @vitest-environment jsdom
import React, { createContext, useContext } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, use: (value: unknown) => value && typeof (value as Promise<unknown>).then === "function" ? { importId: "import-1" } : actual.use(value as never) };
});

const state = vi.hoisted(() => ({
  mode: "normal" as "normal" | "loading" | "error" | "expired",
  data: null as any,
  importCalendar: vi.fn(), importClassroom: vi.fn(), discard: vi.fn(),
  router: { push: vi.fn() }, toast: { success: vi.fn() },
}));
const MockApiError = vi.hoisted(() => class extends Error { status: number; isNotFound: boolean; constructor(status: number) { super("api error"); this.status = status; this.isNotFound = status === 404; } });

vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/hooks/use-api", () => ({
  describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error",
  useApi: (_key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    if (loader) void loader(new AbortController().signal);
    if (state.mode === "loading") return { data: null, error: null, isLoading: true };
    if (state.mode === "error") return { data: null, error: new Error("preview failed"), isLoading: false };
    if (state.mode === "expired") return { data: null, error: new MockApiError(404), isLoading: false };
    return { data: state.data, error: null, isLoading: false };
  },
}));
vi.mock("@/lib/api", () => ({
  ApiError: MockApiError,
  googleImport: {
    getImport: vi.fn(), discardImport: state.discard,
    importCalendarItems: state.importCalendar, importClassroomItems: state.importClassroom,
  },
}));
vi.mock("@/components/page-kit", () => ({
  PageShell: ({ children }: any) => <main>{children}</main>,
  PageHeader: ({ title, description, actions }: any) => <header><h1>{title}</h1><p>{description}</p>{actions}</header>,
  EmptyState: ({ title, children }: any) => <section><h2>{title}</h2><p>{children}</p></section>,
}));
vi.mock("@/components/ui/callout", () => ({ Callout: ({ title, children, actions }: any) => <div role="alert"><strong>{title}</strong><div>{children}</div>{actions}</div> }));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: ({ id, checked, disabled, onCheckedChange }: any) => <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onCheckedChange(e.target.checked)} /> }));
const SelectContext = createContext<(value: string) => void>(() => undefined);
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <SelectContext.Provider value={onValueChange}><div data-value={value}>{children}</div></SelectContext.Provider>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: () => <span>selected</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ value, children }: any) => { const change = useContext(SelectContext); return <button onClick={() => change(value)}>{children}</button>; },
}));

import GoogleImportReviewPage from "./(app)/import/google/[importId]/page";

const calendarItems = [
  { id: "changed", title: "Exam", startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T11:00:00Z", allDay: false, status: "changed" },
  { id: "holiday", title: "Holiday", startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-03T00:00:00Z", allDay: true, status: "new" },
  { id: "same", title: "Already blocked", startsAt: "2026-10-04T00:00:00Z", endsAt: "2026-10-04T01:00:00Z", allDay: false, status: "unchanged" },
];
const classroomItems = [
  { id: "new", title: "Essay", course: "History", dueAt: "2026-10-05T10:00:00Z", suggestedCategory: "Assignment", status: "new", link: "https://classroom.test/essay" },
  { id: "old", title: "Old quiz", course: "History", dueAt: "2026-09-01T10:00:00Z", suggestedCategory: "Exam Preparation", status: "already_imported" },
];
const page = () => <GoogleImportReviewPage params={Promise.resolve({ importId: "import-1" })} />;

beforeEach(() => {
  state.mode = "normal";
  state.data = { source: "google_calendar", items: calendarItems, expiresAt: "2026-10-01T12:00:00Z" };
  state.importCalendar.mockResolvedValue({ created: 2, updated: 1, unchanged: 1, skippedPast: 1, invalidatedFutureSessionIds: ["session-1"] });
  state.importClassroom.mockResolvedValue({ createdTaskIds: ["new"], alreadyImported: ["old"], failed: [{ id: "new", reason: "deadline_passed" }, { id: "old", reason: "other" }] });
  state.discard.mockResolvedValue(undefined);
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Google import review page", () => {
  it("covers loading, expiry, calendar selection, import success, empty, and errors", async () => {
    state.mode = "loading";
    render(page());
    expect(screen.getByText("Loading your import…")).toBeTruthy();
    cleanup();
    state.mode = "expired";
    render(page());
    expect(screen.getByText("This import has expired or was already used")).toBeTruthy();
    cleanup();
    state.mode = "error";
    render(page());
    expect(screen.getByText("Could not load this import")).toBeTruthy();
    cleanup();

    state.mode = "normal";
    render(page());
    expect(screen.getByText("Review your Google Calendar events")).toBeTruthy();
    fireEvent.click(document.getElementById("calendar-holiday")!);
    fireEvent.click(document.getElementById("calendar-holiday")!);
    screen.getByRole("button", { name: "Clear" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Block 0 events" })).toBeTruthy());
    screen.getByRole("button", { name: "Select all" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Block 2 events" })).toBeTruthy());
    screen.getByRole("button", { name: "Block 2 events" }).click();
    await waitFor(() => expect(screen.getByText("Google Calendar import finished")).toBeTruthy());
    expect(screen.getByText(/2 added, 1 updated/)).toBeTruthy();
    expect(screen.getByText(/session no longer fits/)).toBeTruthy();

    cleanup();
    state.data = { source: "google_calendar", items: [], expiresAt: "2026-10-01T12:00:00Z" };
    render(page());
    expect(screen.getByText("No busy events found")).toBeTruthy();
    cleanup();
    state.data = { source: "google_calendar", items: calendarItems, expiresAt: "2026-10-01T12:00:00Z" };
    state.importCalendar.mockRejectedValueOnce(new Error("calendar failed"));
    render(page());
    screen.getByRole("button", { name: /Block 1 event/ }).click();
    await waitFor(() => expect(screen.getByText("calendar failed")).toBeTruthy());
    state.discard.mockRejectedValueOnce(new Error("expired discard"));
    screen.getByRole("button", { name: "Discard" }).click();
    await waitFor(() => expect(state.router.push).toHaveBeenCalledWith("/availability"));
  });

  it("covers Classroom selection, validation, controls, success, empty, and discard", async () => {
    state.data = { source: "google_classroom", items: classroomItems, expiresAt: "2026-10-01T12:00:00Z" };
    render(page());
    expect(screen.getByText("Review your Google Classroom coursework")).toBeTruthy();
    fireEvent.click(document.getElementById("classroom-new")!);
    fireEvent.click(document.getElementById("classroom-new")!);
    const estimate = screen.getByLabelText("Estimate (minutes)");
    fireEvent.change(estimate, { target: { value: "0" } });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(estimate, { target: { value: "90" } });
    screen.getByRole("button", { name: "Category for Essay" }).click();
    screen.getAllByRole("button", { name: "Reading" })[0].click();
    screen.getByRole("button", { name: "Priority for Essay" }).click();
    screen.getAllByRole("button", { name: "High" })[0].click();
    screen.getByRole("button", { name: "Add 1 task" }).click();
    await waitFor(() => expect(screen.getByText("Google Classroom import finished")).toBeTruthy());
    expect(screen.getByText(/1 task added/)).toBeTruthy();
    expect(screen.getByText(/Old quiz/)).toBeTruthy();
    expect(screen.getByText(/due date has already passed/)).toBeTruthy();

    cleanup();
    state.data = { source: "google_classroom", items: [], expiresAt: "2026-10-01T12:00:00Z" };
    render(page());
    expect(screen.getByText("No open coursework found")).toBeTruthy();
    cleanup();
    state.data = { source: "google_classroom", items: classroomItems, expiresAt: "2026-10-01T12:00:00Z" };
    state.importClassroom.mockRejectedValueOnce(new Error("classroom failed"));
    render(page());
    screen.getByRole("button", { name: "Add 1 task" }).click();
    await waitFor(() => expect(screen.getByText("classroom failed")).toBeTruthy());
    screen.getByRole("button", { name: "Discard" }).click();
    await waitFor(() => expect(state.router.push).toHaveBeenCalledWith("/tasks"));

    cleanup();
    state.data = {
      source: "google_calendar",
      items: [{ ...calendarItems[0], id: "multi-day", allDay: true, startsAt: "2026-10-06T00:00:00Z", endsAt: "2026-10-08T00:00:00Z" }],
      expiresAt: "2026-10-01T12:00:00Z",
    };
    state.importCalendar.mockResolvedValueOnce({ created: 1, updated: 0, unchanged: 2, skippedPast: 2, invalidatedFutureSessionIds: ["a", "b"] });
    render(page());
    screen.getByRole("button", { name: "Block 1 event" }).click();
    await waitFor(() => expect(screen.getByText(/1 added, 0 updated/)).toBeTruthy());

    cleanup();
    state.data = {
      source: "google_classroom",
      items: [
        { ...classroomItems[0], id: "new-1", title: "Essay one", course: undefined },
        { ...classroomItems[0], id: "new-2", title: "Essay two", course: undefined },
      ],
      expiresAt: "2026-10-01T12:00:00Z",
    };
    state.importClassroom.mockResolvedValueOnce({
      createdTaskIds: ["new-1", "new-2"],
      alreadyImported: ["old-1", "old-2"],
      failed: [{ id: "missing", reason: "other" }],
    });
    render(page());
    screen.getByRole("button", { name: "Add 2 tasks" }).click();
    await waitFor(() => expect(screen.getByText(/2 tasks added/)).toBeTruthy());
  });
});
