// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "normal" as "normal" | "loading" | "error",
  windows: [] as any[], periods: [] as any[],
  api: { replaceWindows: vi.fn(), updatePeriod: vi.fn(), createPeriod: vi.fn(), deletePeriod: vi.fn(), generate: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const TechnicalFailure = vi.hoisted(() => class extends Error {});

const windowOne = { id: "window-1", dayOfWeek: 1, startTime: "09:00", endTime: "11:00" };
const windowTwo = { id: "window-2", dayOfWeek: 3, startTime: "18:00", endTime: "20:00" };
const period = { id: "period-1", title: "Exam", startDate: "2026-10-01T09:00:00Z", endDate: "2026-10-01T10:00:00Z", reason: "Exam" };

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/hooks/use-api", () => ({
  describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error",
  useApi: (key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    if (loader) void loader(new AbortController().signal);
    const setData = vi.fn();
    const head = Array.isArray(key) ? String(key[0]) : String(key);
    if (state.mode === "loading") return { data: null, error: null, isLoading: true, isValidating: true, reload: vi.fn(), setData };
    if (state.mode === "error") return { data: null, error: new Error("availability failed"), isLoading: false, isValidating: false, reload: vi.fn(), setData };
    if (head.includes("windows")) return { data: state.windows, error: null, isLoading: false, isValidating: false, reload: vi.fn(), setData };
    return { data: state.periods, error: null, isLoading: false, isValidating: false, reload: vi.fn(), setData };
  },
}));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/lib/api", () => {
  return {
    ScheduleTechnicalFailure: TechnicalFailure,
    availability: {
      listWindows: vi.fn(), listUnavailablePeriods: vi.fn(), replaceWindows: state.api.replaceWindows,
      updateUnavailablePeriod: state.api.updatePeriod, createUnavailablePeriod: state.api.createPeriod,
      deleteUnavailablePeriod: state.api.deletePeriod,
    },
    scheduling: { generateProposal: state.api.generate },
  };
});
vi.mock("@/components/page-kit", () => ({
  PageShell: ({ children }: any) => <main>{children}</main>,
  PageHeader: ({ title, description, actions }: any) => <header><h1>{title}</h1><p>{description}</p>{actions}</header>,
  Figure: ({ label, value }: any) => <div>{label}:{value ?? "loading"}</div>,
  FigureRow: ({ children }: any) => <div>{children}</div>,
  SectionCard: ({ title, children, footer }: any) => <section>{title && <h2>{title}</h2>}{children}{footer}</section>,
  EmptyState: ({ title, children, action }: any) => <div><h2>{title}</h2><p>{children}</p>{action}</div>,
}));
vi.mock("@/components/google-import-button", () => ({ GoogleImportButton: () => <button>Google import</button>, GoogleImportReminder: () => <div>Google reminder</div> }));
vi.mock("@/components/week-grid", () => ({
  GridLegend: () => <div>grid legend</div>,
  WeekGrid: ({ blocks, onHighlight }: any) => <div>{blocks.map((block: any) => <React.Fragment key={block.id}><button onMouseEnter={() => onHighlight?.(block.id)} onClick={() => block.onSelect?.({ currentTarget: document.body })}>{block.title}</button><button onClick={() => block.onSelect?.({})}>Select without anchor</button></React.Fragment>)}</div>,
}));
vi.mock("@/components/schedule-preview", () => ({ SchedulePreview: ({ open, onAccepted, onRejected }: any) => open ? <div><button onClick={onAccepted}>Accept plan</button><button onClick={onRejected}>Reject plan</button></div> : null }));
vi.mock("@/components/plan-generation-dialog", () => ({ PlanGenerationDialog: ({ open }: any) => open ? <div>Generating</div> : null }));
vi.mock("@/components/availability-dialogs", () => ({
  AddWindowDialog: ({ open, onSubmit }: any) => open ? <button onClick={() => void onSubmit({ dayOfWeek: 5, startTime: "10:00", endTime: "11:00" })}>Save window</button> : null,
  ExceptionDialog: ({ open, period, onSubmit, onOpenChange }: any) => open ? <><button onClick={() => void onSubmit({ startsAt: "2026-10-02T09:00:00Z", endsAt: "2026-10-02T10:00:00Z", reason: period ? "Updated" : "New" })}>{period ? "Save exception" : "Add exception form"}</button><button onClick={() => onOpenChange?.(false)}>Close exception</button><button onClick={() => onOpenChange?.(true)}>Open exception event</button></> : null,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: ({ open, confirmLabel, onConfirm, onOpenChange }: any) => <><button onClick={() => void onConfirm()}>Invoke confirm with no target</button>{open ? <><button onClick={() => void onConfirm()}>{confirmLabel}</button><button onClick={() => onOpenChange?.(false)}>Cancel window</button><button onClick={() => onOpenChange?.(true)}>Open confirm event</button></> : null}</> }));
vi.mock("@/components/ui/popover", () => ({ Popover: ({ children, open, onOpenChange }: any) => <div>{open && <><button onClick={() => onOpenChange?.(false)}>Close popover</button><button onClick={() => onOpenChange?.(true)}>Open popover event</button></>}{children}</div>, PopoverContent: ({ children }: any) => <div>{children}</div>, PopoverHeader: ({ children }: any) => <div>{children}</div>, PopoverTitle: ({ children }: any) => <h3>{children}</h3>, PopoverDescription: ({ children }: any) => <p>{children}</p> }));

import AvailabilityPage from "./(app)/availability/page";

function normal() {
  state.mode = "normal";
  state.windows = [windowOne, windowTwo];
  state.periods = [period];
  state.api.replaceWindows.mockResolvedValue({ windows: [windowOne], invalidatedFutureSessionIds: ["session-1"] });
  state.api.updatePeriod.mockResolvedValue({ period: { ...period, title: "Updated" }, invalidatedFutureSessionIds: [] });
  state.api.createPeriod.mockResolvedValue({ period: { ...period, id: "period-2" }, invalidatedFutureSessionIds: [] });
  state.api.deletePeriod.mockResolvedValue(undefined);
  state.api.generate.mockResolvedValue({ id: "proposal-1", unscheduledWork: [] });
}
beforeEach(() => { normal(); vi.clearAllMocks(); });
afterEach(cleanup);

describe("availability page", () => {
  it("adds and removes windows, edits exceptions, and re-plans", async () => {
    const view = render(<AvailabilityPage />);
    expect(screen.getByRole("heading", { name: "Availability" })).toBeTruthy();
    screen.getByRole("button", { name: "Invoke confirm with no target" }).click();
    screen.getAllByRole("button", { name: "Select without anchor" })[0].click();
    screen.getAllByRole("button", { name: "Re-plan my time" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" })).toBeTruthy());
    screen.getByRole("button", { name: "Accept plan" }).click();
    screen.getByRole("button", { name: "Add window" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save window" })).toBeTruthy());
    screen.getByRole("button", { name: "Save window" }).click();
    await waitFor(() => expect(screen.getByText(/Your plan is out of date|planned session/)).toBeTruthy());
    screen.getAllByRole("button", { name: "Re-plan my time" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject plan" })).toBeTruthy());
    screen.getByRole("button", { name: "Reject plan" }).click();
    screen.getByRole("button", { name: "Not now" }).click();

    screen.getByRole("button", { name: "Monday 09:00–11:00" }).click();
    fireEvent.mouseEnter(screen.getByText("09:00–11:00"));
    fireEvent.mouseLeave(screen.getByText("09:00–11:00"));
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Monday 09:00–11:00" }));
    fireEvent.mouseLeave(screen.getByRole("button", { name: "Monday 09:00–11:00" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Delete window" }).length).toBeGreaterThan(0));
    screen.getByRole("button", { name: "Open popover event" }).click();
    screen.getByRole("button", { name: "Close popover" }).click();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Delete window" }).length).toBeGreaterThan(0));
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    screen.getByRole("button", { name: "Monday 09:00–11:00" }).click();
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    await waitFor(() => expect(state.api.replaceWindows).toHaveBeenCalled());

    state.windows = [windowOne, windowTwo, { ...windowOne, id: "window-early", startTime: "08:00" }];
    view.rerender(<AvailabilityPage />);

    screen.getAllByRole("button", { name: /Remove Monday/ })[0].click();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Delete window" }).length).toBeGreaterThan(1));
    screen.getByRole("button", { name: "Open confirm event" }).click();
    screen.getByRole("button", { name: "Cancel window" }).click();
    screen.getAllByRole("button", { name: /Remove Monday/ })[0].click();
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    await waitFor(() => expect(state.api.replaceWindows).toHaveBeenCalled());

    screen.getByRole("button", { name: "Add exception" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add exception form" })).toBeTruthy());
    screen.getByRole("button", { name: "Open exception event" }).click();
    screen.getByRole("button", { name: "Add exception form" }).click();

    state.periods = [period, { ...period, id: "period-other", title: "Other" }];
    view.rerender(<AvailabilityPage />);
    screen.getByRole("button", { name: "Edit Exam" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save exception" })).toBeTruthy());
    screen.getByRole("button", { name: "Save exception" }).click();
    screen.getByRole("button", { name: "Close exception" }).click();
    screen.getByRole("button", { name: "Delete Exam" }).click();
    await waitFor(() => expect(state.api.deletePeriod).toHaveBeenCalledWith("period-1"));

    state.windows = [{ ...windowTwo, id: "replacement" }];
    view.rerender(<AvailabilityPage />);

    screen.getByRole("button", { name: "Wednesday 18:00–20:00" }).click();
    state.windows = [{ ...windowTwo, id: "replacement-2" }];
    view.rerender(<AvailabilityPage />);
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    await waitFor(() => expect(state.api.replaceWindows).toHaveBeenCalled());

    state.windows = [windowTwo];
    view.rerender(<AvailabilityPage />);
    screen.getByRole("button", { name: "Wednesday 18:00–20:00" }).click();
    state.windows = [];
    view.rerender(<AvailabilityPage />);
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    await waitFor(() => expect(state.toast.info).toHaveBeenCalledWith("This window is no longer active"));

    state.periods = [period, { ...period, id: "period-wide", endDate: "2026-10-02T10:00:00Z" }];
    view.rerender(<AvailabilityPage />);
    expect(screen.getAllByText("Exam").length).toBeGreaterThan(0);
  });

  it("shows the stale-plan warning when a window invalidates no sessions", async () => {
    state.api.replaceWindows.mockResolvedValue({ windows: [windowOne], invalidatedFutureSessionIds: [] });
    render(<AvailabilityPage />);
    screen.getByRole("button", { name: "Add window" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save window" })).toBeTruthy());
    screen.getByRole("button", { name: "Save window" }).click();
    await waitFor(() => expect(screen.getByText("Your plan is out of date")).toBeTruthy());
    screen.getByRole("button", { name: "Not now" }).click();
    state.api.replaceWindows.mockResolvedValue({ windows: [windowOne], invalidatedFutureSessionIds: ["a", "b"] });
    screen.getByRole("button", { name: "Save window" }).click();
    await waitFor(() => expect(screen.getByText(/2 planned sessions no longer fit/)).toBeTruthy());
    screen.getByRole("button", { name: "Not now" }).click();
  });

  it("deletes a replaced window by matching its current details", async () => {
    const view = render(<AvailabilityPage />);
    screen.getByRole("button", { name: "Monday 09:00–11:00" }).click();
    state.windows = [{ ...windowOne, id: "replacement" }];
    view.rerender(<AvailabilityPage />);
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete window" })).toBeTruthy());
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    await waitFor(() => expect(state.api.replaceWindows).toHaveBeenCalled());

    cleanup();
    normal();
    const staleView = render(<AvailabilityPage />);
    screen.getByRole("button", { name: "Monday 09:00–11:00" }).click();
    state.windows = [windowTwo];
    staleView.rerender(<AvailabilityPage />);
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    await waitFor(() => expect(state.api.replaceWindows).toHaveBeenCalled());
  });

  it("covers loading, empty, errors, and failed mutations", async () => {
    state.mode = "loading";
    render(<AvailabilityPage />);
    expect(screen.getByRole("heading", { name: "Availability" })).toBeTruthy();
    cleanup();
    normal();
    state.mode = "error";
    render(<AvailabilityPage />);
    expect(screen.getByText("Could not load your availability")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    cleanup();
    normal();
    state.windows = [];
    state.periods = [];
    state.api.generate.mockRejectedValueOnce(new Error("planner failed"));
    render(<AvailabilityPage />);
    expect(screen.getByText("No study hours yet")).toBeTruthy();
    screen.getByRole("button", { name: "Add your first window" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save window" })).toBeTruthy());
    screen.getByRole("button", { name: "Save window" }).click();
    state.api.replaceWindows.mockRejectedValueOnce(new Error("save failed"));
    state.windows = [windowOne];
    cleanup();
    render(<AvailabilityPage />);
    screen.getByRole("button", { name: /Remove Monday/ }).click();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Delete window" }).length).toBeGreaterThan(1));
    screen.getAllByRole("button", { name: "Delete window" }).at(-1)!.click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("save failed"));

    state.api.deletePeriod.mockRejectedValueOnce(new Error("delete failed"));
    state.periods = [period];
    cleanup();
    render(<AvailabilityPage />);
    screen.getByRole("button", { name: "Delete Exam" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("delete failed"));
    screen.getAllByRole("button", { name: "Re-plan my time" }).at(-1)!.click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("planner failed"));

    state.api.generate.mockRejectedValueOnce(new TechnicalFailure("technical planner failure"));
    screen.getAllByRole("button", { name: "Re-plan my time" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByText(/technical planner failure/)).toBeTruthy());
    screen.getByRole("button", { name: "Try again" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject plan" })).toBeTruthy());
    screen.getByRole("button", { name: "Reject plan" }).click();
  });
});
