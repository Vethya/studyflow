"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DAY_NAMES_SHORT, formatDuration } from "@/lib/constants";
import { dayKey, minutesByDay } from "@/lib/capacity";
import { availability as availabilityApi, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import type { AcademicTask } from "@/types/task";

// Monday-first display over data indexed 0 = Sunday.
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];

/** Every date shown in a month grid, including the leading and trailing padding. */
function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(first);
  start.setDate(first.getDate() - offset);

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });
}

export default function CalendarPage() {
  const [monthOffset, setMonthOffset] = useState(0);

  const anchor = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }, [monthOffset]);

  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const rangeStart = grid[0];
  const rangeEnd = useMemo(() => {
    const end = new Date(grid[grid.length - 1]);
    end.setDate(end.getDate() + 1);
    return end;
  }, [grid]);

  const loadTasks = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const loadWindows = useCallback(
    (signal: AbortSignal) => availabilityApi.listWindows(signal),
    [],
  );
  const loadPeriods = useCallback(
    (signal: AbortSignal) => availabilityApi.listUnavailablePeriods(signal),
    [],
  );

  const tasks = useApi(loadTasks);
  const windows = useApi(loadWindows);
  const periods = useApi(loadPeriods);

  const isLoading = tasks.isLoading || windows.isLoading || periods.isLoading;
  const loadError = tasks.error ?? windows.error ?? periods.error;

  // Free study minutes per day, already net of blocked-out periods.
  const freeByDay = useMemo(
    () => minutesByDay(windows.data ?? [], periods.data ?? [], rangeStart, rangeEnd),
    [windows.data, periods.data, rangeStart, rangeEnd],
  );

  const peakFree = useMemo(
    () => Math.max(1, ...[...freeByDay.values()]),
    [freeByDay],
  );

  // Deadlines land on the day they fall due, in local time.
  const dueByDay = useMemo(() => {
    const map = new Map<string, AcademicTask[]>();
    for (const task of tasks.data ?? []) {
      const key = dayKey(new Date(task.deadline));
      const bucket = map.get(key);
      if (bucket) bucket.push(task);
      else map.set(key, [task]);
    }
    return map;
  }, [tasks.data]);

  const todayKey = dayKey(new Date());
  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      {/* ── Header ─────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Month</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">{monthLabel}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deadlines against the study time each day actually holds.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMonthOffset((value) => value - 1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 font-mono text-xs"
            onClick={() => setMonthOffset(0)}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMonthOffset((value) => value + 1)}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{describeError(loadError)}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                tasks.reload();
                windows.reload();
                periods.reload();
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Grid ───────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="grid grid-cols-7 gap-px bg-border">
              {Array.from({ length: 42 }).map((_, index) => (
                <Skeleton key={index} className="h-24 rounded-none" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 border-b">
                {DISPLAY_DAYS.map((day) => (
                  <div key={day} className="px-3 py-2 text-center">
                    <span className="eyebrow">{DAY_NAMES_SHORT[day]}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-px bg-border">
                {grid.map((date) => {
                  const key = dayKey(date);
                  const free = freeByDay.get(key) ?? 0;
                  const due = dueByDay.get(key) ?? [];
                  const inMonth = date.getMonth() === anchor.getMonth();

                  return (
                    <DayCell
                      key={key}
                      date={date}
                      free={free}
                      peakFree={peakFree}
                      due={due}
                      inMonth={inMonth}
                      isToday={key === todayKey}
                    />
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Legend ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-8 rounded-full bg-surplus/50" />
          Study time free that day
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-deficit" />
          Deadline
        </span>
        <span>Bars are relative to your busiest day this month.</span>
      </div>
    </div>
  );
}

function DayCell({
  date,
  free,
  peakFree,
  due,
  inMonth,
  isToday,
}: {
  date: Date;
  free: number;
  peakFree: number;
  due: AcademicTask[];
  inMonth: boolean;
  isToday: boolean;
}) {
  const open = due.filter((task) => task.status !== "Completed");

  return (
    <div
      className={cn(
        "flex min-h-24 flex-col gap-1.5 bg-card p-2",
        !inMonth && "bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "font-mono text-xs",
            isToday
              ? "flex h-5 w-5 items-center justify-center rounded-full bg-foreground font-medium text-background"
              : inMonth
                ? "text-foreground"
                : "text-muted-foreground/60",
          )}
        >
          {date.getDate()}
        </span>
        {free > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {Math.round(free / 60)}h
          </span>
        )}
      </div>

      {/* Capacity bar: how much study time this day holds, relative to the
          busiest day on screen. Absent bar means no availability at all. */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-surplus/50"
          style={{ width: `${Math.round((free / peakFree) * 100)}%` }}
        />
      </div>

      <div className="flex flex-col gap-1">
        {open.slice(0, 3).map((task) => (
          <Link
            key={task.id}
            href={`/tasks/${task.id}`}
            title={`${task.title} · ${formatDuration(task.remainingDuration)}`}
            className={cn(
              "flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-[11px] leading-tight transition-colors hover:bg-muted",
              task.status === "Overdue" ? "text-deficit" : "text-foreground",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                task.status === "Overdue" ? "bg-deficit" : "bg-foreground/50",
              )}
            />
            <span className="truncate">{task.title}</span>
          </Link>
        ))}
        {open.length > 3 && (
          <span className="px-1 font-mono text-[10px] text-muted-foreground">
            +{open.length - 3} more
          </span>
        )}
      </div>
    </div>
  );
}
