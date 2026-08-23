"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar as DatePicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DAY_NAMES_SHORT, formatDuration, CATEGORY_CONFIG } from "@/lib/constants";
import { dayKey, expandWindows, startOfDay, subtractPeriods } from "@/lib/capacity";
import { availability as availabilityApi, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useIsMobile } from "@/hooks/use-mobile";
import { TaskFormDialog } from "@/components/task-form-dialog";
import type { AcademicTask } from "@/types/task";

const DAY_MS = 86_400_000;
const HOUR_PX = 40;
/** Fallback range when the student has no availability to derive one from. */
const DEFAULT_RANGE = { start: 8, end: 22 };

/** Monday-first week containing `date`. */
function weekStart(date: Date): Date {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - offset);
  return day;
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export default function CalendarPage() {
  const isMobile = useIsMobile();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [dialogOpen, setDialogOpen] = useState(false);

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

  const allTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
  const allWindows = useMemo(() => windows.data ?? [], [windows.data]);
  const allPeriods = useMemo(() => periods.data ?? [], [periods.data]);

  // SPEC §17.3: desktop shows one week; mobile shows a single day.
  const days = useMemo(() => {
    if (isMobile) return [startOfDay(anchor)];
    const start = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }, [anchor, isMobile]);

  const rangeStart = days[0];
  // Memoised so the interval computations below do not see a fresh Date on
  // every render and recompute needlessly.
  const rangeEnd = useMemo(
    () => new Date(days[days.length - 1].getTime() + DAY_MS),
    [days],
  );

  // Grid hours are derived from the student's own windows so the view is not
  // mostly empty space; falls back to a sensible day when none exist.
  const hourRange = useMemo(() => {
    if (allWindows.length === 0) return DEFAULT_RANGE;
    let min = 24;
    let max = 0;
    for (const w of allWindows) {
      const s = Number(w.startTime.slice(0, 2));
      const e = Number(w.endTime.slice(0, 2));
      min = Math.min(min, s);
      max = Math.max(max, e <= s ? 24 : e + (w.endTime.slice(3) === "00" ? 0 : 1));
    }
    return { start: Math.max(0, min - 1), end: Math.min(24, Math.max(max + 1, min + 6)) };
  }, [allWindows]);

  const hours = useMemo(
    () => Array.from({ length: hourRange.end - hourRange.start }, (_, i) => hourRange.start + i),
    [hourRange],
  );

  /** Free study intervals, already net of unavailable periods. */
  const freeIntervals = useMemo(
    () => subtractPeriods(expandWindows(allWindows, rangeStart, rangeEnd), allPeriods),
    [allWindows, allPeriods, rangeStart, rangeEnd],
  );

  /** Raw windows before subtraction, so blocked time can be drawn distinctly. */
  const rawIntervals = useMemo(
    () => expandWindows(allWindows, rangeStart, rangeEnd),
    [allWindows, rangeStart, rangeEnd],
  );

  const deadlinesByDay = useMemo(() => {
    const map = new Map<string, AcademicTask[]>();
    for (const task of allTasks) {
      if (task.status === "Completed") continue;
      const key = dayKey(new Date(task.deadline));
      const bucket = map.get(key);
      if (bucket) bucket.push(task);
      else map.set(key, [task]);
    }
    return map;
  }, [allTasks]);

  // SPEC §17.3: a compact forward view, independent of the visible grid.
  const agenda = useMemo(() => {
    const from = new Date();
    const to = new Date(from.getTime() + 14 * DAY_MS);
    return allTasks
      .filter((t) => t.status !== "Completed")
      .filter((t) => {
        const d = new Date(t.deadline);
        return d >= startOfDay(from) && d < to;
      })
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  }, [allTasks]);

  const grouped = useMemo(() => {
    const active = allTasks.filter((t) => t.status === "In Progress" || t.status === "Not Started");
    return {
      overdue: allTasks.filter((t) => t.status === "Overdue"),
      active,
      completed: allTasks.filter((t) => t.status === "Completed"),
    };
  }, [allTasks]);

  const todayKey = dayKey(new Date());
  const label = isMobile
    ? anchor.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : `${days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  function shift(direction: number) {
    const step = isMobile ? DAY_MS : 7 * DAY_MS;
    setAnchor(new Date(anchor.getTime() + direction * step));
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{isMobile ? "Day" : "Week"}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">{label}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border bg-card">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => shift(-1)}
              aria-label={isMobile ? "Previous day" : "Previous week"}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 font-mono text-xs"
              onClick={() => setAnchor(new Date())}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => shift(1)}
              aria-label={isMobile ? "Next day" : "Next week"}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* SPEC §17.3 requires a date picker, not just week stepping. */}
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline" size="sm" className="h-8">
                  <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
                  Jump to
                </Button>
              }
            />
            <PopoverContent className="w-auto p-0" align="end">
              <DatePicker
                mode="single"
                selected={anchor}
                onSelect={(date) => date && setAnchor(date)}
                autoFocus
              />
            </PopoverContent>
          </Popover>

          <Button size="sm" className="h-8" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Task
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

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        {/* ── Time grid ─────────────────────────────────────── */}
        <div className="min-w-0">
          {isLoading ? (
            <Skeleton className="h-[28rem] w-full" />
          ) : (
            <div className="overflow-hidden rounded-md border bg-card">
              {/* Day headers */}
              <div
                className="grid border-b"
                style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}
              >
                <div />
                {days.map((day) => {
                  const isToday = dayKey(day) === todayKey;
                  const due = deadlinesByDay.get(dayKey(day)) ?? [];
                  return (
                    <div key={day.toISOString()} className="min-w-0 border-l px-1 py-2 text-center">
                      <div className="eyebrow">{DAY_NAMES_SHORT[day.getDay()]}</div>
                      <div
                        className={cn(
                          "mx-auto mt-1 flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs",
                          isToday && "bg-foreground font-medium text-background",
                        )}
                      >
                        {day.getDate()}
                      </div>

                      {/* Deadlines are moments, not blocks of work: they belong
                          here rather than pinned to an hour on the grid, which
                          is reserved for Study Sessions. */}
                      <div className="mt-1.5 space-y-0.5">
                        {due.slice(0, 2).map((task) => (
                          <Link
                            key={task.id}
                            href={`/tasks/${task.id}`}
                            title={`${task.title} — due ${new Date(task.deadline).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                            className="flex items-center gap-1 truncate rounded-sm border-l-2 border-deficit bg-deficit-soft px-1 py-0.5 text-left text-[10px] leading-tight text-foreground transition-colors hover:bg-muted"
                          >
                            <span className="truncate">{task.title}</span>
                          </Link>
                        ))}
                        {due.length > 2 && (
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            +{due.length - 2}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Hour rows */}
              <div className="relative max-h-[32rem] overflow-y-auto">
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}
                >
                  {/* Hour gutter */}
                  <div>
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="relative border-b border-transparent"
                        style={{ height: HOUR_PX }}
                      >
                        <span className="absolute -top-1.5 right-2 font-mono text-[10px] text-muted-foreground">
                          {String(h).padStart(2, "0")}
                        </span>
                      </div>
                    ))}
                  </div>

                  {days.map((day) => (
                    <DayColumn
                      key={day.toISOString()}
                      day={day}
                      hours={hours}
                      hourRange={hourRange}
                      raw={rawIntervals}
                      free={freeIntervals}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Legend — every mark on the grid, named. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground">
            <Legend className="border-surplus/40 bg-surplus-soft">Available</Legend>
            <Legend className="bg-muted [background-image:repeating-linear-gradient(135deg,var(--color-border)_0_4px,transparent_4px_8px)]">
              Blocked
            </Legend>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0.5 rounded-full bg-deficit" />
              Deadline
            </span>
          </div>
        </div>

        {/* ── Task rail (SPEC §17.3) ────────────────────────── */}
        <aside className="min-w-0 space-y-5">
          <TaskGroup title="Overdue" tasks={grouped.overdue} tone="deficit" />
          <TaskGroup title="Active" tasks={grouped.active} />
          <TaskGroup title="Completed" tasks={grouped.completed} muted />
        </aside>
      </div>

      {/* ── Next 14 days (SPEC §17.3) ───────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between gap-3 border-b pb-2">
          <h2 className="font-display text-base font-semibold tracking-tight">Next 14 days</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {agenda.length} {agenda.length === 1 ? "deadline" : "deadlines"}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2 pt-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : agenda.length === 0 ? (
          <p className="pt-4 text-sm text-muted-foreground">
            No deadlines in the next two weeks.
          </p>
        ) : (
          <ul className="divide-y">
            {agenda.map((task) => {
              const due = new Date(task.deadline);
              return (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex items-center gap-4 py-2.5 transition-colors hover:bg-muted/40"
                  >
                    <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                      {due.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                    </span>
                    <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                      {due.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {CATEGORY_CONFIG[task.category].label}
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
                      {formatDuration(task.remainingDuration)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Shared task form, per SPEC §20.1 and §17.3. */}
      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={(task) => tasks.setData([task, ...allTasks])}
      />
    </div>
  );
}

function Legend({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-3 w-5 rounded-sm border", className)} />
      {children}
    </span>
  );
}

function DayColumn({
  day,
  hours,
  hourRange,
  raw,
  free,
}: {
  day: Date;
  hours: number[];
  hourRange: { start: number; end: number };
  raw: { start: Date; end: Date }[];
  free: { start: Date; end: Date }[];
}) {
  const dayStart = startOfDay(day);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const topOf = (d: Date) =>
    ((minutesSinceMidnight(d) - hourRange.start * 60) / 60) * HOUR_PX;

  const clip = (interval: { start: Date; end: Date }) => {
    const start = interval.start < dayStart ? dayStart : interval.start;
    const end = interval.end > dayEnd ? dayEnd : interval.end;
    return end > start ? { start, end } : null;
  };

  const rawToday = raw.map(clip).filter(Boolean) as { start: Date; end: Date }[];
  const freeToday = free.map(clip).filter(Boolean) as { start: Date; end: Date }[];

  return (
    <div className="relative border-l">
      {hours.map((h) => (
        <div key={h} className="border-b border-border/50" style={{ height: HOUR_PX }} />
      ))}

      {/* The whole window, hatched — so time blocked by an Unavailable Period
          stays legible without relying on colour (SPEC §19.5). */}
      {rawToday.map((interval, i) => (
        <div
          key={`raw-${i}`}
          className="absolute inset-x-0.5 rounded-sm border border-border bg-muted [background-image:repeating-linear-gradient(135deg,var(--color-border)_0_4px,transparent_4px_8px)]"
          style={{
            top: topOf(interval.start),
            height: Math.max(2, topOf(interval.end) - topOf(interval.start)),
          }}
        />
      ))}

      {/* What survives after Unavailable Periods are subtracted. */}
      {freeToday.map((interval, i) => (
        <div
          key={`free-${i}`}
          className="absolute inset-x-0.5 rounded-sm border border-surplus/40 bg-surplus-soft"
          style={{
            top: topOf(interval.start),
            height: Math.max(2, topOf(interval.end) - topOf(interval.start)),
          }}
        />
      ))}
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  tone,
  muted,
}: {
  title: string;
  tasks: AcademicTask[];
  tone?: "deficit";
  muted?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-b pb-1.5">
        <h3 className={cn("eyebrow", tone === "deficit" && tasks.length > 0 && "text-deficit")}>
          {title}
        </h3>
        <span className="font-mono text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="pt-2 text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="pt-1">
          {tasks.slice(0, 6).map((task) => (
            <li key={task.id}>
              <Link
                href={`/tasks/${task.id}`}
                className={cn(
                  "block truncate py-1.5 text-xs transition-colors hover:text-foreground",
                  muted ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {task.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
