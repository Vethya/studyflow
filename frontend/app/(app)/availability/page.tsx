"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { Plus, Trash2, CalendarDays, CalendarOff, Clock4, Loader2, Pencil, RefreshCw, X } from "lucide-react";
import { EmptyState, PageHeader, PageShell, StatTile } from "@/components/page-kit";
import { GridLegend, WeekGrid, type GridBlock, type GridColumn } from "@/components/week-grid";
import { toast } from "sonner";
import { DAY_NAMES, DAY_NAMES_SHORT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ScheduleTechnicalFailure, availability as availabilityApi, scheduling } from "@/lib/api";
import { SchedulePreview } from "@/components/schedule-preview";
import type { WindowDraft } from "@/lib/api";
import type { UnavailablePeriod } from "@/types/availability";
import type { ScheduleProposal } from "@/types/schedule";
import { formatDuration } from "@/lib/constants";
import { weeklyPatternMinutes } from "@/lib/capacity";
import { describeError, useApi } from "@/hooks/use-api";
import { AddWindowDialog, ExceptionDialog } from "@/components/availability-dialogs";

/** Display Monday-first while the data itself is indexed 0 = Sunday. */
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];

/** `"18:30"` → minutes since midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export default function AvailabilityPage() {
  const [hoveredWindow, setHoveredWindow] = useState<string | null>(null);
  const [windowDialogOpen, setWindowDialogOpen] = useState(false);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<UnavailablePeriod | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  /**
   * SPEC §17.5: a saved availability change can invalidate future sessions.
   * Their count is surfaced, and the student may then ask for a new plan —
   * StudyFlow never regenerates on its own (SPEC §11.1).
   */
  const [invalidatedCount, setInvalidatedCount] = useState(0);
  const [planStale, setPlanStale] = useState(false);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isGenerating, setGenerating] = useState(false);
  const [technicalFailure, setTechnicalFailure] = useState<string | null>(null);

  async function requestRegeneration() {
    setGenerating(true);
    setTechnicalFailure(null);
    try {
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

  const windows = useApi(loadWindows);
  const periods = useApi(loadPeriods);

  const allWindows = useMemo(() => windows.data ?? [], [windows.data]);
  const allPeriods = useMemo(() => periods.data ?? [], [periods.data]);

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
        title: `${DAY_NAMES[w.dayOfWeek]} ${w.startTime}–${w.endTime}`,
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

  const toDraft = (): WindowDraft[] =>
    allWindows.map((w) => ({
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
    }));

  /**
   * There is no per-window endpoint: the whole weekly set is replaced on every
   * change, so both adding and removing go through the same PUT.
   */
  async function saveWindows(next: WindowDraft[]) {
    const saved = await availabilityApi.replaceWindows(next);
    windows.setData(saved);
  }

  async function handleAddWindow(draft: WindowDraft) {
    await saveWindows([...toDraft(), draft]);
    setInvalidatedCount((count) => count || 0);
    setPlanStale(true);
    toast.success("Window added");
  }

  async function handleDeleteWindow(id: string) {
    setPendingId(id);
    try {
      await saveWindows(
        allWindows
          .filter((w) => w.id !== id)
          .map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
      );
      setPlanStale(true);
      toast.success("Window removed");
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setPendingId(null);
    }
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
      setInvalidatedCount(change.invalidatedFutureSessionIds.length);
      toast.success("Exception updated");
      setEditingPeriod(null);
      return;
    }

    const change = await availabilityApi.createUnavailablePeriod(draft);
    periods.setData([...allPeriods, change.period]);
    setInvalidatedCount(change.invalidatedFutureSessionIds.length);
    toast.success("Exception added");
  }

  async function handleDeleteException(id: string) {
    setPendingId(id);
    try {
      await availabilityApi.deleteUnavailablePeriod(id);
      periods.setData(allPeriods.filter((period) => period.id !== id));
      toast.success("Exception removed");
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setPendingId(null);
    }
  }

  const loadError = windows.error ?? periods.error;

  return (
    <PageShell>
      <PageHeader
        title="Availability"
        description="The hours you are free to study. Everything StudyFlow tells you about your workload is measured against these."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void requestRegeneration()}
              disabled={isGenerating}
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Re-plan my time
            </Button>
            <Button variant="outline" onClick={() => setExceptionDialogOpen(true)}>
              <CalendarOff />
              Add exception
            </Button>
            <Button onClick={() => setWindowDialogOpen(true)}>
              <Plus />
              Add window
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
          {technicalFailure} This is a problem on our side, not a sign that your work does
          not fit. Your current plan has not changed.
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
              >
                {isGenerating && <Loader2 className="animate-spin" />}
                Re-plan my time
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setInvalidatedCount(0);
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

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          icon={Clock4}
          value={windows.isLoading ? null : formatDuration(weeklyPatternMinutes(allWindows))}
          label="Weekly study time"
          tone="surplus"
        />
        <StatTile
          icon={CalendarDays}
          value={windows.isLoading ? null : String(allWindows.length)}
          label={allWindows.length === 1 ? "Weekly window" : "Weekly windows"}
        />
        <StatTile
          icon={CalendarOff}
          value={periods.isLoading ? null : String(allPeriods.length)}
          label={allPeriods.length === 1 ? "Exception" : "Exceptions"}
        />
      </div>

      {/* ── Main content ───────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          <div>
            <h2 className="font-display text-base font-semibold tracking-tight">Your week</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The same grid the calendar uses. Hover a window to find it in the list.
            </p>
          </div>

          {windows.isLoading ? (
            <Skeleton className="h-[26rem] w-full rounded-xl" />
          ) : allWindows.length === 0 ? (
            <EmptyState
              icon={Clock4}
              title="No study hours yet"
              action={
                <Button size="sm" onClick={() => setWindowDialogOpen(true)}>
                  Add your first window
                </Button>
              }
            >
              Tell StudyFlow when you are free and it can tell you what fits.
            </EmptyState>
          ) : (
            <WeekGrid
              columns={columns}
              blocks={blocks}
              hourStart={hourRange.start}
              hourEnd={hourRange.end}
              highlightedId={hoveredWindow}
              onHighlight={setHoveredWindow}
            />
          )}
          <GridLegend />
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-col gap-4">

          {/*
            One row per weekday rather than a heading plus a row for every
            window. Eight windows used to render sixteen stacked elements and
            hid the days you are *not* free, which is exactly what you look at
            this list to check.
          */}
          <Card className="py-0">
            <CardHeader className="border-b py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-base">Your weekly hours</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {formatDuration(weeklyPatternMinutes(allWindows))} a week
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {windows.isLoading ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <ul className="divide-y">
                  {DISPLAY_DAYS.map((dayIdx) => {
                    const dayWindows = sortedAvail.filter((a) => a.dayOfWeek === dayIdx);
                    const dayMinutes = dayWindows.reduce(
                      (sum, w) => sum + (toMinutes(w.endTime) - toMinutes(w.startTime)),
                      0,
                    );
                    return (
                      <li
                        key={dayIdx}
                        className="flex items-start gap-3 px-4 py-2.5"
                      >
                        <span
                          className={cn(
                            "w-10 shrink-0 pt-1 text-xs font-medium",
                            dayWindows.length > 0
                              ? "text-foreground"
                              : "text-muted-foreground/60",
                          )}
                        >
                          {DAY_NAMES_SHORT[dayIdx]}
                        </span>

                        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                          {dayWindows.length === 0 ? (
                            <span className="pt-1 text-xs text-muted-foreground/60">
                              Not free
                            </span>
                          ) : (
                            dayWindows.map((w) => (
                              <span
                                key={w.id}
                                onMouseEnter={() => setHoveredWindow(w.id)}
                                onMouseLeave={() => setHoveredWindow(null)}
                                className={cn(
                                  "group/window flex items-center gap-1 rounded-md border py-1 ps-2 pe-1 text-xs tabular-nums transition-colors",
                                  hoveredWindow === w.id
                                    ? "border-surplus bg-surplus/25"
                                    : "border-surplus/40 bg-surplus-soft",
                                )}
                              >
                                {w.startTime}–{w.endTime}
                                <button
                                  onClick={() => void handleDeleteWindow(w.id)}
                                  disabled={pendingId === w.id}
                                  aria-label={`Remove ${DAY_NAMES[dayIdx]} ${w.startTime} to ${w.endTime}`}
                                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-card hover:text-deficit"
                                >
                                  {pendingId === w.id ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <X className="size-3" />
                                  )}
                                </button>
                              </span>
                            ))
                          )}
                        </div>

                        <span
                          className={cn(
                            "w-14 shrink-0 pt-1 text-end text-xs tabular-nums",
                            dayMinutes > 0 ? "text-muted-foreground" : "text-muted-foreground/50",
                          )}
                        >
                          {dayMinutes > 0 ? formatDuration(dayMinutes) : "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Unavailable periods */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base">Exceptions</CardTitle>
              <p className="text-sm text-muted-foreground">Days you know you cannot study</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {periods.isLoading ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : allPeriods.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No exceptions.
                </p>
              ) : (
                allPeriods.map((period) => {
                  const start = new Date(period.startDate);
                  const end = new Date(period.endDate);
                  const sameDay = start.toDateString() === end.toDateString();
                  return (
                    <div
                      key={period.id}
                      className="flex items-start justify-between rounded-lg border bg-muted/30 p-3 gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background border">
                          <CalendarOff className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{period.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {sameDay
                              ? start.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                              : `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
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
                        disabled={pendingId === period.id}
                        aria-label={`Edit ${period.title}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => void handleDeleteException(period.id)}
                        disabled={pendingId === period.id}
                        aria-label={`Delete ${period.title}`}
                      >
                        {pendingId === period.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
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
        unavailablePeriods={allPeriods}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onAccepted={() => {
          setProposal(null);
          setInvalidatedCount(0);
          setPlanStale(false);
        }}
        onRejected={() => setProposal(null)}
      />

      <AddWindowDialog
        open={windowDialogOpen}
        onOpenChange={setWindowDialogOpen}
        onSubmit={handleAddWindow}
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
    </PageShell>
  );
}
