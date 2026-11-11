// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    const head = Array.isArray(key) ? String(key[0]) : String(key);
    // Run functional updates against both a loaded and an empty cache.
    const setData = vi.fn((next: unknown) => {
      if (typeof next !== "function") return;
      next(head.includes("windows") ? state.windows : state.periods);
      next(null);
    });
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
    ensureSentence: (detail: string) => /[.!?]$/.test(detail) ? detail : `${detail}.`,
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
  AddWindowDialog: ({ open, onSubmit, onOpenChange, window, existing }: any) => open ? <><button onClick={() => void onSubmit({ dayOfWeek: 5, startTime: "10:00", endTime: "11:00" })}>{window ? `Save edit of ${window.startTime}` : "Save window"}</button><span>{existing.length} existing</span><button onClick={() => onOpenChange?.(false)}>Close window dialog</button><button onClick={() => onOpenChange?.(true)}>Open window event</button></> : null,
  ExceptionDialog: ({ open, period, onSubmit, onOpenChange }: any) => open ? <><button onClick={() => void onSubmit({ startsAt: "2026-10-02T09:00:00Z", endsAt: "2026-10-02T10:00:00Z", reason: period ? "Updated" : "New" })}>{period ? "Save exception" : "Add exception form"}</button><button onClick={() => onOpenChange?.(false)}>Close exception</button><button onClick={() => onOpenChange?.(true)}>Open exception event</button></> : null,
}));
vi.mock("@/components/ui/popover", () => ({ Popover: ({ children, open, onOpenChange }: any) => <div>{open && <><button onClick={() => onOpenChange?.(false)}>Close popover</button><button onClick={() => onOpenChange?.(true)}>Open popover event</button></>}{children}</div>, PopoverContent: ({ children }: any) => <div>{children}</div>, PopoverHeader: ({ children }: any) => <div>{children}</div>, PopoverTitle: ({ children }: any) => <h3>{children}</h3>, PopoverDescription: ({ children }: any) => <p>{children}</p> }));

import AvailabilityPage from "./(app)/availability/page";
import { flushPendingActions, resetUndoState, UNDO_WINDOW_MS } from "@/lib/undo";

/** Removals wait out an undo window; tests commit them at once. */
const commitPending = () => act(() => flushPendingActions());

async function confirmRemoval(label: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });
}

/** A server that saves exactly the week it is sent. */
const echoSave = async (drafts: any[]) => ({
  windows: drafts.map((draft, index) => ({ id: `saved-${index}`, ...draft })),
  invalidatedFutureSessionIds: [],
});
const wednesdayDraft = { dayOfWeek: 3, startTime: "18:00", endTime: "20:00" };

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
afterEach(() => {
  cleanup();
  resetUndoState();
});

describe("availability page", () => {
  it.each(["chip", "popover", "exception"] as const)("confirms removal from the %s, supports Cancel, and keeps Undo", async (entry) => {
    render(<AvailabilityPage />);
    const isException = entry === "exception";
    const itemLabel = isException ? "Delete Exam" : "Remove Monday 09:00 to 11:00";
    const confirmLabel = isException ? "Delete exception" : "Remove study hours";
    const title = isException ? "Delete “Exam”?" : "Remove Monday 09:00–11:00?";
    const item = screen.getByRole("button", { name: itemLabel });
    const openConfirmation = () => {
      if (entry === "popover") {
        fireEvent.click(screen.getByRole("button", { name: "Monday 09:00–11:00" }));
        fireEvent.click(screen.getByRole("button", { name: "Remove" }));
        expect(screen.queryByText("Study hours every week")).toBeNull();
      } else {
        fireEvent.click(item);
      }
    };

    openConfirmation();
    const dialog = screen.getByRole("dialog", { name: title });
    expect(within(dialog).getByText(isException
      ? "This time will be open for study again."
      : "You will have less time to study on this day. Planned sessions may need rescheduling.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" })));
    expect(item.isConnected).toBe(true);
    expect(state.toast.success).not.toHaveBeenCalled();
    await commitPending();
    expect(state.api.replaceWindows).not.toHaveBeenCalled();
    expect(state.api.deletePeriod).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: itemLabel })).toBeTruthy();
    await commitPending();
    expect(state.api.replaceWindows).not.toHaveBeenCalled();
    expect(state.api.deletePeriod).not.toHaveBeenCalled();
    expect(state.toast.success).not.toHaveBeenCalled();

    openConfirmation();
    await confirmRemoval(confirmLabel);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: itemLabel })).toBeNull();
    expect(state.toast.success).toHaveBeenCalledWith(isException ? "Exception removed" : "Study hours removed", expect.objectContaining({
      description: isException ? "Exam" : "Monday 09:00–11:00",
      duration: UNDO_WINDOW_MS,
      action: { label: "Undo", onClick: expect.any(Function) },
    }));
    expect(state.api.replaceWindows).not.toHaveBeenCalled();
    expect(state.api.deletePeriod).not.toHaveBeenCalled();
    act(() => state.toast.success.mock.calls.at(-1)![1].action.onClick());
    expect(screen.getByRole("button", { name: itemLabel })).toBeTruthy();
    await commitPending();
    expect(state.api.replaceWindows).not.toHaveBeenCalled();
    expect(state.api.deletePeriod).not.toHaveBeenCalled();
  });

  it("adds, edits and removes study hours with undo, edits exceptions, and re-plans", async () => {
    const view = render(<AvailabilityPage />);
    expect(screen.getByRole("heading", { name: "Availability" })).toBeTruthy();
    expect(screen.getByText(/2 blocks of study hours on 2 days/)).toBeTruthy();
    screen.getAllByRole("button", { name: "Select without anchor" })[0].click();
    screen.getAllByRole("button", { name: "Re-plan my time" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" })).toBeTruthy());
    screen.getByRole("button", { name: "Accept plan" }).click();
    screen.getByRole("button", { name: "Add study hours" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save window" })).toBeTruthy());
    expect(screen.getByText("2 existing")).toBeTruthy();
    screen.getByRole("button", { name: "Open window event" }).click();
    screen.getByRole("button", { name: "Save window" }).click();
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith("Study hours added"));
    expect(state.api.replaceWindows).toHaveBeenLastCalledWith([
      { dayOfWeek: 1, startTime: "09:00", endTime: "11:00" },
      { dayOfWeek: 3, startTime: "18:00", endTime: "20:00" },
      { dayOfWeek: 5, startTime: "10:00", endTime: "11:00" },
    ]);
    await waitFor(() => expect(screen.getByText(/Your plan is out of date|planned session/)).toBeTruthy());
    screen.getAllByRole("button", { name: "Re-plan my time" }).at(-1)!.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject plan" })).toBeTruthy());
    screen.getByRole("button", { name: "Reject plan" }).click();
    screen.getByRole("button", { name: "Not now" }).click();
    screen.getByRole("button", { name: "Close window dialog" }).click();

    // The page refetches after a save; the mock server answers with the
    // original week again.
    const revalidate = () => {
      state.windows = [windowOne, windowTwo];
      view.rerender(<AvailabilityPage />);
    };

    // Edit from the grid popover replaces just that window.
    revalidate();
    screen.getByRole("button", { name: "Monday 09:00–11:00" }).click();
    fireEvent.mouseEnter(screen.getByText("09:00–11:00"));
    fireEvent.mouseLeave(screen.getByText("09:00–11:00"));
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Monday 09:00–11:00" }));
    fireEvent.mouseLeave(screen.getByRole("button", { name: "Monday 09:00–11:00" }));
    screen.getByRole("button", { name: "Open popover event" }).click();
    screen.getByRole("button", { name: "Close popover" }).click();
    screen.getByRole("button", { name: "Monday 09:00–11:00" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
    screen.getByRole("button", { name: "Edit" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save edit of 09:00" })).toBeTruthy());
    screen.getByRole("button", { name: "Save edit of 09:00" }).click();
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith("Study hours updated"));
    expect(state.api.replaceWindows).toHaveBeenLastCalledWith([
      { dayOfWeek: 3, startTime: "18:00", endTime: "20:00" },
      { dayOfWeek: 5, startTime: "10:00", endTime: "11:00" },
    ]);
    screen.getByRole("button", { name: "Close window dialog" }).click();

    // Edit from the day list, then cancel.
    screen.getByRole("button", { name: "Edit Wednesday 18:00 to 20:00" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save edit of 18:00" })).toBeTruthy());
    screen.getByRole("button", { name: "Close window dialog" }).click();

    // Confirmed removal hides the window and saves after the undo window.
    revalidate();
    state.api.replaceWindows.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Monday 09:00–11:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await confirmRemoval("Remove study hours");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Monday 09:00–11:00" })).toBeNull());
    expect(state.toast.success).toHaveBeenCalledWith("Study hours removed", expect.objectContaining({ description: "Monday 09:00–11:00" }));
    expect(state.api.replaceWindows).not.toHaveBeenCalled();
    await commitPending();
    expect(state.api.replaceWindows).toHaveBeenCalledWith([{ dayOfWeek: 3, startTime: "18:00", endTime: "20:00" }]);

    // Two removals committed together save one after the other, each
    // leaving out only its own window from what the one before it saved.
    state.api.replaceWindows.mockClear();
    state.api.replaceWindows.mockImplementation(echoSave);
    state.windows = [windowOne, windowTwo];
    view.rerender(<AvailabilityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Monday 09:00–11:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await confirmRemoval("Remove study hours");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Monday 09:00–11:00" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Remove Wednesday/ }));
    await confirmRemoval("Remove study hours");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Remove Wednesday/ })).toBeNull());
    await commitPending();
    expect(state.api.replaceWindows.mock.calls).toEqual([[[wednesdayDraft]], [[]]]);

    // Undo brings a removed window back without saving anything.
    state.api.replaceWindows.mockClear();
    view.rerender(<AvailabilityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Remove Wednesday/ }));
    await confirmRemoval("Remove study hours");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Remove Wednesday/ })).toBeNull());
    const undo = state.toast.success.mock.calls.at(-1)![1].action.onClick;
    act(() => undo());
    expect(screen.getByRole("button", { name: /Remove Wednesday/ })).toBeTruthy();
    await commitPending();
    expect(state.api.replaceWindows).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Monday 09:00–11:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Close popover" }));
    screen.getAllByRole("button", { name: "Select without anchor" })[0].click();

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
    fireEvent.click(screen.getByRole("button", { name: "Delete Exam" }));
    await confirmRemoval("Delete exception");
    // The row leaves at once; the request waits out the undo window.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete Exam" })).toBeNull());
    expect(state.toast.success).toHaveBeenCalledWith("Exception removed", expect.objectContaining({ description: "Exam" }));
    expect(state.api.deletePeriod).not.toHaveBeenCalled();
    await commitPending();
    expect(state.api.deletePeriod).toHaveBeenCalledWith("period-1");

    state.periods = [period, { ...period, id: "period-wide", endDate: "2026-10-02T10:00:00Z" }];
    view.rerender(<AvailabilityPage />);
    expect(screen.getAllByText("Exam").length).toBeGreaterThan(0);
  });

  it("keeps a pending removal undoable after another removal saves", async () => {
    vi.useFakeTimers();
    try {
      state.api.replaceWindows.mockImplementation(echoSave);
      render(<AvailabilityPage />);
      fireEvent.click(screen.getByRole("button", { name: /Remove Monday/ }));
      await confirmRemoval("Remove study hours");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      fireEvent.click(screen.getByRole("button", { name: /Remove Wednesday/ }));
      await confirmRemoval("Remove study hours");
      const undoWednesday = state.toast.success.mock.calls.at(-1)![1].action.onClick;

      // Monday's timer fires first; its save must still contain Wednesday.
      await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 1000));
      expect(state.api.replaceWindows.mock.calls).toEqual([[[wednesdayDraft]]]);

      act(() => undoWednesday());
      expect(screen.getByRole("button", { name: /Remove Wednesday/ })).toBeTruthy();
      await commitPending();
      await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS));
      expect(state.api.replaceWindows).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for an earlier save before sending the next one", async () => {
    let finishFirst!: () => void;
    state.api.replaceWindows
      .mockImplementationOnce((drafts: any[]) => new Promise((resolve) => { finishFirst = () => resolve(echoSave(drafts)); }))
      .mockImplementation(echoSave);
    render(<AvailabilityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Remove Monday/ }));
    await confirmRemoval("Remove study hours");
    fireEvent.click(screen.getByRole("button", { name: /Remove Wednesday/ }));
    await confirmRemoval("Remove study hours");
    let flushed = false;
    const flushing = (async () => {
      await commitPending();
      flushed = true;
    })();
    await waitFor(() => expect(state.api.replaceWindows).toHaveBeenCalledTimes(1));
    expect(flushed).toBe(false);
    finishFirst();
    await flushing;
    expect(flushed).toBe(true);
    expect(state.api.replaceWindows.mock.calls).toEqual([[[wednesdayDraft]], [[]]]);
  });

  it("opens dialogs from day rows and exception shortcuts, and commits a removal", async () => {
    // A zero-length window is drawn as nothing on the hour strip.
    state.windows = [windowOne, { ...windowOne, id: "window-empty", startTime: "12:00", endTime: "12:00" }];
    const view = render(<AvailabilityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add study hours on Monday" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save window" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Add another exception" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add exception form" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close exception" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete Exam" }));
    await confirmRemoval("Delete exception");
    await commitPending();
    expect(state.api.deletePeriod).toHaveBeenCalledWith("period-1");

    state.periods = [];
    view.rerender(<AvailabilityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add an exception" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add exception form" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Save window" }));
    await waitFor(() => expect(screen.getByText(/planned session no longer fits/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "Re-plan my time" })[0]);
    await waitFor(() => expect(state.api.generate).toHaveBeenCalled());
  });

  it("shows the stale-plan warning when a window invalidates no sessions", async () => {
    state.api.replaceWindows.mockResolvedValue({ windows: [windowOne], invalidatedFutureSessionIds: [] });
    render(<AvailabilityPage />);
    screen.getByRole("button", { name: "Add study hours" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save window" })).toBeTruthy());
    screen.getByRole("button", { name: "Save window" }).click();
    await waitFor(() => expect(screen.getByText("Your plan is out of date")).toBeTruthy());
    screen.getByRole("button", { name: "Not now" }).click();
    state.api.replaceWindows.mockResolvedValue({ windows: [windowOne], invalidatedFutureSessionIds: ["a", "b"] });
    screen.getByRole("button", { name: "Save window" }).click();
    await waitFor(() => expect(screen.getByText(/2 planned sessions no longer fit/)).toBeTruthy());
    screen.getByRole("button", { name: "Not now" }).click();
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
    screen.getByRole("button", { name: "Add your first study hours" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save window" })).toBeTruthy());
    screen.getByRole("button", { name: "Save window" }).click();
    await waitFor(() => expect(state.api.replaceWindows).toHaveBeenCalled());
    state.api.replaceWindows.mockRejectedValueOnce(new Error("save failed"));
    state.windows = [windowOne];
    cleanup();
    render(<AvailabilityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Remove Monday/ }));
    await confirmRemoval("Remove study hours");
    await commitPending();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("save failed"));
    // A failed removal puts the study hours back.
    expect(screen.getByRole("button", { name: /Remove Monday/ })).toBeTruthy();

    state.api.deletePeriod.mockRejectedValueOnce(new Error("delete failed"));
    state.periods = [period];
    cleanup();
    render(<AvailabilityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Exam" }));
    await confirmRemoval("Delete exception");
    await commitPending();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("delete failed"));
    // A failed removal puts the exception back.
    expect(screen.getByRole("button", { name: "Delete Exam" })).toBeTruthy();
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
