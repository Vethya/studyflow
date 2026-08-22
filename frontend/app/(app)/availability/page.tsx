"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Plus, Trash2, CalendarOff, Clock4, Info, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { DAY_NAMES, DAY_NAMES_SHORT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { availability as availabilityApi } from "@/lib/api";
import type { WindowDraft } from "@/lib/api";
import type { UnavailablePeriod } from "@/types/availability";
import { formatDuration } from "@/lib/constants";
import { weeklyPatternMinutes } from "@/lib/capacity";
import { describeError, useApi } from "@/hooks/use-api";
import { AddWindowDialog, ExceptionDialog } from "@/components/availability-dialogs";

// Build a 30-min grid from 7:00 to 22:00
const HOUR_START = 7;
const HOUR_END = 22;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

function timeToSlot(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h - HOUR_START) * 2 + (m >= 30 ? 1 : 0);
}

// Display Monday-first while the data itself is indexed 0 = Sunday.
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];

export default function AvailabilityPage() {
  const [hoveredWindow, setHoveredWindow] = useState<string | null>(null);
  const [windowDialogOpen, setWindowDialogOpen] = useState(false);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<UnavailablePeriod | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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

  // Lookup for the grid: dayOfWeek → occupied slot ranges.
  const avMap = useMemo(() => {
    const map: Record<number, { id: string; startSlot: number; endSlot: number }[]> = {};
    for (const w of allWindows) {
      (map[w.dayOfWeek] ??= []).push({
        id: w.id,
        startSlot: timeToSlot(w.startTime),
        endSlot: timeToSlot(w.endTime),
      });
    }
    return map;
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
      toast.success("Exception updated");
      setEditingPeriod(null);
      return;
    }

    const change = await availabilityApi.createUnavailablePeriod(draft);
    periods.setData([...allPeriods, change.period]);
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
    <div className="flex flex-col gap-6 p-6">
      {/* ── Header ─────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Study time</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Availability</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The hours you are free to study. Everything StudyFlow tells you about
            your workload is measured against these.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setExceptionDialogOpen(true)}>
            <CalendarOff className="mr-1.5 h-4 w-4" />
            Add Exception
          </Button>
          <Button size="sm" onClick={() => setWindowDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Window
          </Button>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{describeError(loadError)}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                windows.reload();
                periods.reload();
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Weekly total, stated plainly — it is the number the dashboard divides by. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="eyebrow">Weekly pattern</span>
          <span className="font-mono text-lg font-medium">
            {windows.isLoading ? "—" : formatDuration(weeklyPatternMinutes(allWindows))}
          </span>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Overlapping windows on the same day are merged by the server.
        </span>
      </div>

      {/* ── Main content ───────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">

        {/* Visual time grid */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base">Weekly Schedule</CardTitle>
            <CardDescription>
              Shaded blocks are the hours you can study
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-4">
            <div className="overflow-x-auto">
              <div
                className="grid min-w-[480px]"
                style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}
              >
                {/* Day headers */}
                <div className="border-b" />
                {DISPLAY_DAYS.map((dayIdx) => (
                  <div
                    key={dayIdx}
                    className="border-b border-l py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                  >
                    {DAY_NAMES_SHORT[dayIdx]}
                  </div>
                ))}

                {/* Time rows — 30-min slots */}
                {HOURS.map((hour) => (
                  <div key={hour} className="contents">
                    {/* Hour label */}
                    <div className="relative">
                      <span className="absolute -top-2 right-2 text-[10px] text-muted-foreground tabular-nums">
                        {hour % 12 === 0 ? 12 : hour % 12}
                        {hour < 12 ? "am" : "pm"}
                      </span>
                      <div className="h-6 border-b border-muted/40" />
                      <div className="h-6 border-b border-muted/20" />
                    </div>

                    {/* Each day cell */}
                    {DISPLAY_DAYS.map((dayIdx) => {
                      const slotTop = (hour - HOUR_START) * 2;
                      const slotBot = slotTop + 1;
                      const windowsTop = (avMap[dayIdx] || []).filter(
                        (w) => slotTop >= w.startSlot && slotTop < w.endSlot
                      );
                      const windowsBot = (avMap[dayIdx] || []).filter(
                        (w) => slotBot >= w.startSlot && slotBot < w.endSlot
                      );
                      return (
                        <div key={`${dayIdx}-${hour}`} className="border-l">
                          {/* Top half */}
                          <div
                            className={cn(
                              "h-6 border-b border-muted/40 transition-colors",
                              windowsTop.length > 0
                                ? hoveredWindow && windowsTop.some(w => w.id === hoveredWindow)
                                  ? "bg-surplus/55"
                                  : "bg-surplus/25"
                                : "hover:bg-muted/50"
                            )}
                            onMouseEnter={() => windowsTop[0] && setHoveredWindow(windowsTop[0].id)}
                            onMouseLeave={() => setHoveredWindow(null)}
                          />
                          {/* Bottom half */}
                          <div
                            className={cn(
                              "h-6 border-b border-muted/20 transition-colors",
                              windowsBot.length > 0
                                ? hoveredWindow && windowsBot.some(w => w.id === hoveredWindow)
                                  ? "bg-surplus/55"
                                  : "bg-surplus/25"
                                : "hover:bg-muted/50"
                            )}
                            onMouseEnter={() => windowsBot[0] && setHoveredWindow(windowsBot[0].id)}
                            onMouseLeave={() => setHoveredWindow(null)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 px-4 pt-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="h-3 w-5 rounded-sm bg-surplus/25" />
                Available
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="h-3 w-5 rounded-sm bg-muted" />
                Unavailable
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="flex flex-col gap-4">

          {/* Windows list */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-base">Windows</CardTitle>
                <span className="text-xs text-muted-foreground">{allWindows.length} total</span>
              </div>
              <CardDescription>Hover a row to highlight it on the grid</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0 p-0">
              {windows.isLoading ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : allWindows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No windows yet. Add one so sessions can be scheduled.
                </p>
              ) : (
                DAY_NAMES.map((dayName, dayIdx) => {
                  const dayWindows = sortedAvail.filter((a) => a.dayOfWeek === dayIdx);
                  if (dayWindows.length === 0) return null;
                  return (
                    <div key={dayIdx}>
                      <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-t first:border-t-0">
                        {dayName}
                      </div>
                      {dayWindows.map((w) => (
                        <div
                          key={w.id}
                          className={cn(
                            "flex items-center justify-between px-4 py-2.5 border-b last:border-0 transition-colors cursor-default",
                            hoveredWindow === w.id ? "bg-surplus-soft" : "hover:bg-muted/40"
                          )}
                          onMouseEnter={() => setHoveredWindow(w.id)}
                          onMouseLeave={() => setHoveredWindow(null)}
                        >
                          <div className="flex items-center gap-2">
                            <Clock4 className="h-3.5 w-3.5 shrink-0 text-surplus" />
                            <span className="text-sm tabular-nums">
                              {w.startTime} – {w.endTime}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => void handleDeleteWindow(w.id)}
                            disabled={pendingId === w.id}
                          >
                            {pendingId === w.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Unavailable periods */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base">Exceptions</CardTitle>
              <CardDescription>One-off periods where you&apos;re not available</CardDescription>
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
    </div>
  );
}
