"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import {
  GoogleImportButton,
  GoogleImportReminder,
} from "@/components/google-import-button";
import { Plus, Trash2, CalendarOff, Clock4, Loader2, Pencil, RefreshCw, X } from "@/components/icons";
import {
  EmptyState,
  PageHeader,
  PageShell,
  SectionCard,
} from "@/components/page-kit";
import { GridLegend, WeekGrid, type GridBlock, type GridColumn } from "@/components/week-grid";
import { toast } from "sonner";
import { DAY_NAMES, DAY_NAMES_SHORT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ScheduleTechnicalFailure, availability as availabilityApi, ensureSentence, scheduling } from "@/lib/api";
import { SchedulePreview } from "@/components/schedule-preview";
import { PlanGenerationDialog } from "@/components/plan-generation-dialog";
import type { WindowDraft } from "@/lib/api";
import type { UnavailablePeriod, AvailabilityWindow } from "@/types/availability";
import type { ScheduleProposal } from "@/types/schedule";
import { formatDuration } from "@/lib/constants";
import { weeklyPatternMinutes } from "@/lib/capacity";
import { flushPendingActions, scheduleUndoable } from "@/lib/undo";
import { DateLeaf } from "@/components/study-kit";
import { describeError, useApi } from "@/hooks/use-api";
import { AddWindowDialog, ExceptionDialog } from "@/components/availability-dialogs";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { SWR_KEYS } from "@/lib/swr-keys";
import { dayKey, formatClock, formatDate, formatHour } from "@/lib/datetime";
import { useAccountTimezone } from "@/hooks/use-account-timezone";

/** Display Monday-first while the data itself is indexed 0 = Sunday. */
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];

/** `"18:30"` → minutes since midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Windows are matched by their times: every replace-all save issues new ids. */
function windowKey(w: WindowDraft): string {
  return `${w.dayOfWeek}|${w.startTime}|${w.endTime}`;
}

function toDraft(w: WindowDraft): WindowDraft {
  return { dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime };
}

export default function AvailabilityPage() {
  const timeZone = useAccountTimezone();
  const [selectedWindow, setSelectedWindow] = useState<{
    window: AvailabilityWindow;
    anchorEl: HTMLElement | null;
  } | null>(null);
  const [hoveredWindow, setHoveredWindow] = useState<string | null>(null);
  const [windowDialogOpen, setWindowDialogOpen] = useState(false);
  const [windowDialogDay, setWindowDialogDay] = useState(1);
  const [editingWindow, setEditingWindow] = useState<AvailabilityWindow | null>(null);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<UnavailablePeriod | null>(null);
  /**
   * SPEC §17.5: a saved availability change can invalidate future sessions.
   * Their count is surfaced, and the student may then ask for a new plan —
   * StudyFlow never regenerates on its own (SPEC §11.1).
   */
  const [invalidatedSessionIds, setInvalidatedSessionIds] = useState<Set<string>>(new Set());
  const invalidatedCount = invalidatedSessionIds.size;
  const [planStale, setPlanStale] = useState(false);

  const recordInvalidatedSessions = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setInvalidatedSessionIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isGenerating, setGenerating] = useState(false);
  const [technicalFailure, setTechnicalFailure] = useState<string | null>(null);

  async function requestRegeneration() {
    setGenerating(true);
    setTechnicalFailure(null);
    try {
      // A removal still inside its undo window must land before planning,
      // or the planner would still see that exception.
      await flushPendingActions();
      const next = await scheduling.generateProposal();
      setProposal(next);
      setPreviewOpen(true);
    } catch (cause) {
      if (cause instanceof ScheduleTechnicalFailure) setTechnicalFailure(cause.message);
      else toast.error(describeError(cause));
    } finally {
      setGenerating(false);
    }
  }

  const loadWindows = useCallback(
    (signal: AbortSignal) => availabilityApi.listWindows(signal),
    [],
  );
  const loadPeriods = useCallback(
    (signal: AbortSignal) => availabilityApi.listUnavailablePeriods(signal),
    [],
  );

  const windows = useApi(SWR_KEYS.availabilityWindows, loadWindows);
  const periods = useApi(SWR_KEYS.unavailablePeriods, loadPeriods);

  /** Study hours whose removal is still inside its undo window. */
  const [removingWindowKeys, setRemovingWindowKeys] = useState<ReadonlySet<string>>(new Set());
  const allWindows = useMemo(
    () => (windows.data ?? []).filter((w) => !removingWindowKeys.has(windowKey(w))),
    [windows.data, removingWindowKeys],
  );
  // The undo commit runs seconds later and must save against what is current then.
  const latestWindows = useRef<AvailabilityWindow[]>([]);
  useEffect(() => {
    latestWindows.current = windows.data ?? [];
  }, [windows.data]);
  /** The tail of the save queue; see `queueSave`. */
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const allPeriods = useMemo(() => periods.data ?? [], [periods.data]);
  /** Exceptions whose removal is still inside its undo window. */
  const [removingPeriodIds, setRemovingPeriodIds] = useState<ReadonlySet<string>>(new Set());
  const visiblePeriods = useMemo(
    () => allPeriods.filter((period) => !removingPeriodIds.has(period.id)),
    [allPeriods, removingPeriodIds],
  );

  const columns: GridColumn[] = useMemo(
    () => DISPLAY_DAYS.map((day) => ({ key: String(day), label: DAY_NAMES_SHORT[day] })),
    [],
  );

  const blocks: GridBlock[] = useMemo(
    () =>
      allWindows.map((w) => ({
        id: w.id,
        columnKey: String(w.dayOfWeek),
        start: toMinutes(w.startTime),
        end: toMinutes(w.endTime),
        variant: "available" as const,
        label: "Study time",
        meta: `${w.startTime}–${w.endTime}`,
        title: `${DAY_NAMES[w.dayOfWeek]} ${w.startTime}–${w.endTime}`,
        onSelect: (e) => setSelectedWindow({ window: w, anchorEl: e?.currentTarget ?? null }),
      })),
    [allWindows],
  );

  // The grid spans the student's own hours with an hour of air either side,
  // so a pattern of evening-only windows does not render as a wall of empty
  // morning. The fallback matches a plausible study day.
  const hourRange = useMemo(() => {
    if (allWindows.length === 0) return { start: 7, end: 22 };
    let min = 24 * 60;
    let max = 0;
    for (const w of allWindows) {
      min = Math.min(min, toMinutes(w.startTime));
      max = Math.max(max, toMinutes(w.endTime));
    }
    return {
      start: Math.max(0, Math.floor(min / 60) - 1),
      end: Math.min(24, Math.max(Math.ceil(max / 60) + 1, Math.floor(min / 60) + 6)),
    };
  }, [allWindows]);

  const sortedAvail = useMemo(
    () =>
      [...allWindows].sort((a, b) =>
        a.dayOfWeek !== b.dayOfWeek
          ? a.dayOfWeek - b.dayOfWeek
          : a.startTime.localeCompare(b.startTime),
      ),
    [allWindows],
  );

  /**
   * There is no per-window endpoint: the whole weekly set is replaced on every
   * change, so adding, editing and removing all go through the same PUT.
   */
  async function saveWindows(next: WindowDraft[]) {
    const saved = await availabilityApi.replaceWindows(next);
    // Set here, not only on re-render: a queued save may start before React
    // has rendered this one's result.
    latestWindows.current = saved.windows;
    windows.setData(saved.windows);
    recordInvalidatedSessions(saved.invalidatedFutureSessionIds);
    setPlanStale(true);
    return saved;
  }

  /**
   * Saves run one at a time, each building its week from what the one before
   * it saved, so overlapping saves never undo each other.
   */
  function queueSave(build: () => WindowDraft[]) {
    const job = saveQueue.current.then(() => saveWindows(build()));
    saveQueue.current = job.catch(() => undefined);
    return job;
  }

  async function handleSaveWindow(draft: WindowDraft) {
    const replacing = editingWindow ? windowKey(editingWindow) : null;
    await queueSave(() => [
      ...latestWindows.current.filter((w) => windowKey(w) !== replacing).map(toDraft),
      draft,
    ]);
    toast.success(editingWindow ? "Study hours updated" : "Study hours added");
  }

  function handleDeleteWindow(target: AvailabilityWindow) {
    const key = windowKey(target);
    const reveal = () =>
      setRemovingWindowKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    setRemovingWindowKeys((current) => new Set(current).add(key));
    scheduleUndoable({
      key: `window:${key}`,
      message: "Study hours removed",
      description: `${DAY_NAMES[target.dayOfWeek]} ${target.startTime}–${target.endTime}`,
      // Each removal saves only its own window's absence. Another removal
      // still inside its undo window stays saved, so its Undo keeps working.
      commit: async () => {
        await queueSave(() =>
          latestWindows.current.filter((w) => windowKey(w) !== key).map(toDraft),
        );
      },
      onCommitted: reveal,
      onUndo: reveal,
      onError: (cause) => {
        reveal();
        return describeError(cause);
      },
    });
  }

  function openEditWindow(target: AvailabilityWindow) {
    setEditingWindow(target);
    setWindowDialogDay(target.dayOfWeek);
    setWindowDialogOpen(true);
  }

  async function handleSaveException(draft: {
    startsAt: string;
    endsAt: string;
    reason?: string;
  }) {
    if (editingPeriod) {
      const change = await availabilityApi.updateUnavailablePeriod(editingPeriod.id, draft);
      periods.setData(
        allPeriods.map((period) =>
          period.id === editingPeriod.id ? change.period : period,
        ),
      );
      recordInvalidatedSessions(change.invalidatedFutureSessionIds);
      toast.success("Exception updated");
      setEditingPeriod(null);
      return;
    }

    const change = await availabilityApi.createUnavailablePeriod(draft);
    periods.setData([...allPeriods, change.period]);
    recordInvalidatedSessions(change.invalidatedFutureSessionIds);
    toast.success("Exception added");
  }

  function handleDeleteException(target: UnavailablePeriod) {
    const reveal = () =>
      setRemovingPeriodIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
    setRemovingPeriodIds((current) => new Set(current).add(target.id));
    scheduleUndoable({
      key: `period:${target.id}`,
      message: "Exception removed",
      description: target.title,
      commit: () => availabilityApi.deleteUnavailablePeriod(target.id),
      onCommitted: () =>
        periods.setData((current) => (current ?? []).filter((period) => period.id !== target.id)),
      onUndo: reveal,
      onError: (cause) => {
        reveal();
        return describeError(cause);
      },
    });
  }

  const loadError = windows.error ?? periods.error;

  const weeklyMinutes = weeklyPatternMinutes(allWindows);
  const minutesByDay = DISPLAY_DAYS.map((day) =>
    allWindows
      .filter((w) => w.dayOfWeek === day)
      .reduce((sum, w) => sum + (toMinutes(w.endTime) - toMinutes(w.startTime)), 0),
  );
  const busiestDay = Math.max(60, ...minutesByDay);
  const daysWithTime = minutesByDay.filter((minutes) => minutes > 0).length;

  function openAddWindow(day = 1) {
    setWindowDialogDay(day);
    setWindowDialogOpen(true);
  }

  return (
    <PageShell>
      <PageHeader
        icon={Clock4}
        eyebrow="Study hours"
        title="Availability"
        description="When you can study each week. StudyFlow only plans sessions inside these hours."
        actions={
          <>
            <GoogleImportButton source="google_calendar" />
            <Button variant="outline" onClick={() => setExceptionDialogOpen(true)}>
              <CalendarOff />
              Add exception
            </Button>
            <Button onClick={() => openAddWindow()}>
              <Plus />
              Add study hours
            </Button>
          </>
        }
      />

      {loadError && (
        <Callout
          tone="danger"
          title="Could not load your availability"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                windows.reload();
                periods.reload();
              }}
            >
              Try again
            </Button>
          }
        >
          {describeError(loadError)}
        </Callout>
      )}

      {technicalFailure && (
        <Callout
          tone="danger"
          title="StudyFlow could not work out a plan"
          actions={
            <Button variant="outline" size="sm" onClick={() => void requestRegeneration()}>
              Try again
            </Button>
          }
        >
          {ensureSentence(technicalFailure)} This is a problem on our side, not a sign that
          your work does not fit. Your current plan has not changed.
        </Callout>
      )}

      {/* SPEC §17.5: say what the change broke, then offer the remedy. */}
      {(invalidatedCount > 0 || planStale) && (
        <Callout
          tone="warning"
          title={
            invalidatedCount > 0
              ? `${invalidatedCount} planned ${
                  invalidatedCount === 1 ? "session no longer fits" : "sessions no longer fit"
                }`
              : "Your plan is out of date"
          }
          actions={
            <>
              <Button
                size="sm"
                onClick={() => void requestRegeneration()}
                disabled={isGenerating}
                aria-busy={isGenerating}
              >
                {isGenerating && <Loader2 className="animate-spin" />}
                Re-plan my time
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setInvalidatedSessionIds(new Set());
                  setPlanStale(false);
                }}
              >
                Not now
              </Button>
            </>
          }
        >
          {invalidatedCount > 0
            ? "That work has been put back on your list. StudyFlow can look for new slots whenever you are ready."
            : "You changed your study hours, so your current sessions may no longer be the best fit."}
        </Callout>
      )}

      <GoogleImportReminder source="google_calendar" />

      {/* ── Weekly summary: the total, and how it spreads over the week ── */}
      <Card className="rise-in relative overflow-hidden">
        <CardContent className="flex flex-col gap-6 @3xl/dashboard:flex-row @3xl/dashboard:items-end @3xl/dashboard:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Your study week</p>
            {windows.isLoading ? (
              <Skeleton className="mt-2 h-10 w-44" />
            ) : (
              <p className="mt-1 text-[2.5rem] leading-none tabular-nums font-semibold tracking-tight">
                {formatDuration(weeklyMinutes)}
                <span className="ms-2 font-sans text-base text-muted-foreground">each week</span>
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              {windows.isLoading || periods.isLoading
                ? " "
                : `${allWindows.length} ${allWindows.length === 1 ? "block of study hours" : "blocks of study hours"} on ${daysWithTime} ${daysWithTime === 1 ? "day" : "days"} · ${visiblePeriods.length} ${visiblePeriods.length === 1 ? "exception" : "exceptions"}`}
            </p>
          </div>

          <div className="flex flex-col gap-4 @xl/dashboard:flex-row @xl/dashboard:items-end">
            {/* A glance at the week's shape; the grid below has the detail. */}
            <ol className="flex items-end gap-1.5" aria-label="Study time per day">
              {DISPLAY_DAYS.map((day, index) => {
                const minutes = minutesByDay[index];
                return (
                  <li key={day} className="flex w-9 flex-col items-center gap-1.5">
                    <span className="whitespace-nowrap text-[0.625rem] tabular-nums text-muted-foreground">
                      {minutes > 0 ? formatDuration(minutes) : "–"}
                    </span>
                    <span className="flex h-14 w-full items-end overflow-hidden rounded-md bg-muted/60">
                      <span
                        className={cn(
                          "w-full rounded-md transition-[height] duration-500 ease-fluid",
                          minutes > 0 ? "bg-surplus/75" : "bg-transparent",
                        )}
                        style={{ height: `${Math.max(minutes > 0 ? 12 : 0, (minutes / busiestDay) * 100)}%` }}
                      />
                    </span>
                    <span className={cn("text-xs font-medium", minutes > 0 ? "text-foreground" : "text-muted-foreground")}>
                      {DAY_NAMES_SHORT[day]}
                    </span>
                    <span className="sr-only">{minutes > 0 ? formatDuration(minutes) : "No study time"}</span>
                  </li>
                );
              })}
            </ol>
            <Button
              variant="outline"
              onClick={() => void requestRegeneration()}
              disabled={isGenerating}
              aria-busy={isGenerating}
              className="shrink-0"
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Re-plan my time
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Main content ───────────────────────── */}
      <div className="grid min-w-0 items-start gap-6 @5xl/dashboard:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 @5xl/dashboard:col-span-2">
          <SectionCard
            title="Your week"
            description="Green blocks are when you can study. Select one to change or remove it."
            flush
            footer={<GridLegend />}
          >
            {windows.isLoading ? (
              <Skeleton className="m-(--card-spacing) h-[26rem] rounded-lg" />
            ) : allWindows.length === 0 ? (
              <EmptyState
                icon={Clock4}
                className="border-0 py-14"
                title="No study hours yet"
                action={
                  <Button size="sm" onClick={() => openAddWindow()}>
                    Add your first study hours
                  </Button>
                }
              >
                Tell StudyFlow when you are free and it can tell you what fits.
              </EmptyState>
            ) : (
              <WeekGrid
                className="rounded-none border-0"
                ariaLabel="Weekly availability"
                columns={columns}
                blocks={blocks}
                hourStart={hourRange.start}
                hourEnd={hourRange.end}
                highlightedId={hoveredWindow}
                onHighlight={setHoveredWindow}
                fit
              />
            )}
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-col gap-4">
          {/*
            One row per weekday rather than a heading plus a row for every
            window, so the days you are *not* free stay visible, which is
            exactly what you look at this list to check.
          */}
          <Card>
            <CardHeader>
              <CardTitle>Day by day</CardTitle>
              <CardDescription>Add or remove hours for each weekday.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {windows.isLoading ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <ul className="divide-y">
                  {DISPLAY_DAYS.map((dayIdx, index) => {
                    const dayWindows = sortedAvail.filter((a) => a.dayOfWeek === dayIdx);
                    const dayMinutes = minutesByDay[index];
                    const free = dayWindows.length > 0;
                    return (
                      <li key={dayIdx} className="group/day px-4 py-3 compact:py-2">
                        <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "w-8 shrink-0 text-xs font-semibold",
                            free ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {DAY_NAMES_SHORT[dayIdx]}
                        </span>

                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          {!free ? (
                            <span className="text-xs text-muted-foreground">No study time</span>
                          ) : (
                            dayWindows.map((w) => (
                              <span
                                key={w.id}
                                onMouseEnter={() => setHoveredWindow(w.id)}
                                onMouseLeave={() => setHoveredWindow(null)}
                                className={cn(
                                  "flex items-center gap-1 rounded-full border py-0.5 ps-2.5 pe-0.5 text-xs font-medium tabular-nums transition-colors",
                                  hoveredWindow === w.id
                                    ? "border-surplus/70 bg-surplus/25"
                                    : "border-surplus/30 bg-surplus/10",
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => openEditWindow(w)}
                                  aria-label={`Edit ${DAY_NAMES[dayIdx]} ${w.startTime} to ${w.endTime}`}
                                  className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {w.startTime}–{w.endTime}
                                </button>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => handleDeleteWindow(w)}
                                  aria-label={`Remove ${DAY_NAMES[dayIdx]} ${w.startTime} to ${w.endTime}`}
                                  className="size-5 rounded-full text-muted-foreground hover:bg-card hover:text-deficit"
                                >
                                  <X className="size-3" />
                                </Button>
                              </span>
                            ))
                          )}
                        </div>

                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {dayMinutes > 0 ? formatDuration(dayMinutes) : ""}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => openAddWindow(dayIdx)}
                          aria-label={`Add study hours on ${DAY_NAMES[dayIdx]}`}
                        >
                          <Plus />
                        </Button>
                        </div>
                        {free && (
                          <HourStrip
                            windows={dayWindows}
                            hourStart={hourRange.start}
                            hourEnd={hourRange.end}
                            highlightedId={hoveredWindow}
                            className="ms-11 me-9 mt-2"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Unavailable periods */}
          <Card>
            <CardHeader>
              <CardTitle>Exceptions</CardTitle>
              <CardDescription>One-off times you cannot study, like a trip or an appointment.</CardDescription>
              {visiblePeriods.length > 0 && (
                <CardAction>
                  <Button variant="ghost" size="icon-sm" onClick={() => setExceptionDialogOpen(true)} aria-label="Add another exception">
                    <Plus />
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {periods.isLoading ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : visiblePeriods.length === 0 ? (
                <EmptyState
                  icon={CalendarOff}
                  title="No exceptions"
                  className="py-5"
                  action={
                    <Button variant="outline" size="sm" onClick={() => setExceptionDialogOpen(true)}>
                      Add an exception
                    </Button>
                  }
                >
                  Have an appointment or a day off? Block that time so it stays out of your study plan.
                </EmptyState>
              ) : (
                visiblePeriods.map((period) => {
                  const start = new Date(period.startDate);
                  const end = new Date(period.endDate);
                  const sameDay = dayKey(start, timeZone) === dayKey(end, timeZone);
                  return (
                    <div
                      key={period.id}
                      className="group/period flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 transition-colors duration-150 hover-fine:bg-muted/40"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <DateLeaf date={start} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{period.title}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {sameDay
                              ? `${formatDate(start, timeZone, { weekday: "short" })} · ${formatClock(start, timeZone)}–${formatClock(end, timeZone)}`
                              : `${formatDate(start, timeZone, { month: "short", day: "numeric" })} – ${formatDate(end, timeZone, { month: "short", day: "numeric" })}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditingPeriod(period);
                            setExceptionDialogOpen(true);
                          }}
                          aria-label={`Edit ${period.title}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDeleteException(period)}
                          aria-label={`Delete ${period.title}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <SchedulePreview
        proposal={proposal}
        availabilityWindows={allWindows}
        unavailablePeriods={visiblePeriods}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onAccepted={() => {
          setProposal(null);
          setInvalidatedSessionIds(new Set());
          setPlanStale(false);
        }}
        onRejected={() => setProposal(null)}
      />

      <PlanGenerationDialog open={isGenerating} />

      <AddWindowDialog
        open={windowDialogOpen}
        onOpenChange={(next) => {
          setWindowDialogOpen(next);
          if (!next) setEditingWindow(null);
        }}
        onSubmit={handleSaveWindow}
        defaultDay={windowDialogDay}
        window={editingWindow}
        existing={allWindows}
      />
      <ExceptionDialog
        open={exceptionDialogOpen}
        onOpenChange={(next) => {
          setExceptionDialogOpen(next);
          if (!next) setEditingPeriod(null);
        }}
        period={editingPeriod}
        onSubmit={handleSaveException}
      />

      <Popover
        open={selectedWindow !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedWindow(null);
        }}
      >
        <PopoverContent
          anchor={selectedWindow?.anchorEl ?? undefined}
          align="center"
          side="top"
          className="w-56 p-3"
        >
          {selectedWindow && (
            <>
              <PopoverHeader className="gap-0.5">
                <PopoverTitle className="text-xs font-semibold text-foreground">
                  {`${DAY_NAMES[selectedWindow.window.dayOfWeek]} · ${selectedWindow.window.startTime}–${selectedWindow.window.endTime}`}
                </PopoverTitle>
                <PopoverDescription className="text-[11px] text-muted-foreground">
                  Study hours every week
                </PopoverDescription>
              </PopoverHeader>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedWindow(null);
                    openEditWindow(selectedWindow.window);
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setSelectedWindow(null);
                    handleDeleteWindow(selectedWindow.window);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </PageShell>
  );
}

/**
 * One day's windows along the same hours the grid shows, so the shape of a
 * day reads at a glance in the list too — useful on a phone, where the grid
 * has to scroll sideways.
 */
function HourStrip({
  windows,
  hourStart,
  hourEnd,
  highlightedId,
  className,
}: {
  windows: AvailabilityWindow[];
  hourStart: number;
  hourEnd: number;
  highlightedId: string | null;
  className?: string;
}) {
  const from = hourStart * 60;
  const span = Math.max(60, hourEnd * 60 - from);
  const middle = Math.round((hourStart + hourEnd) / 2);
  return (
    <div aria-hidden className={cn("relative", className)}>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        {windows.map((w) => {
          const start = Math.max(0, toMinutes(w.startTime) - from);
          const end = Math.min(span, toMinutes(w.endTime) - from);
          if (end <= start) return null;
          return (
            <span
              key={w.id}
              className={cn(
                "absolute inset-y-0 rounded-full transition-colors duration-150",
                highlightedId === w.id ? "bg-surplus" : "bg-surplus/60",
              )}
              style={{ left: `${(start / span) * 100}%`, width: `${((end - start) / span) * 100}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[0.625rem] tabular-nums text-muted-foreground">
        <span>{formatHour(hourStart)}</span>
        <span>{formatHour(middle)}</span>
        <span>{formatHour(hourEnd)}</span>
      </div>
    </div>
  );
}
