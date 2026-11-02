"use client";

import { formatDuration } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface DayLoad {
  key: string;
  /** "Mon" */
  label: string;
  /** "Monday 28 September", for screen readers. */
  longLabel: string;
  /** "28" */
  dayNumber: string;
  /** Free study minutes left after exceptions. */
  free: number;
  /** Minutes of study sessions booked. */
  planned: number;
  deadlines: number;
  isToday: boolean;
}

/**
 * The week as seven small columns: how much time is free each day (the
 * outline) and how much of it is booked (the fill). It answers "which days
 * are heavy?" before the timetable is read, and doubles as a day picker.
 *
 * Bars share one scale across the week, so a short bar means a short day —
 * the same ghost-and-solid language as the dashboard's weekly chart.
 */
export function WeekLoad({
  days,
  selectedKey,
  onSelect,
  loading = false,
  className,
}: {
  days: DayLoad[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  loading?: boolean;
  className?: string;
}) {
  const scale = Math.max(60, ...days.map((day) => Math.max(day.free, day.planned)));

  return (
    <div
      role="group"
      aria-label="Your week at a glance"
      aria-busy={loading || undefined}
      className={cn("grid grid-cols-7 gap-1 @2xl/dashboard:gap-2", className)}
    >
      {days.map((day) => {
        const selected = selectedKey === day.key;
        // A session booked outside study hours still shows, as a full bar.
        const capacity = Math.max(day.free, day.planned);
        const outerHeight = Math.max(8, (capacity / scale) * 100);
        const fillHeight = capacity > 0 ? (day.planned / capacity) * 100 : 0;
        const summary = [
          day.free > 0 ? `${formatDuration(day.planned)} planned, ${formatDuration(Math.max(0, day.free - day.planned))} still free` : "No study time",
          day.deadlines > 0 && `${day.deadlines} ${day.deadlines === 1 ? "deadline" : "deadlines"}`,
        ]
          .filter(Boolean)
          .join(", ");

        return (
          <button
            key={day.key}
            type="button"
            onClick={() => onSelect?.(day.key)}
            aria-pressed={selectedKey !== undefined ? selected : undefined}
            aria-label={`${day.longLabel}${day.isToday ? " (today)" : ""}: ${summary}`}
            className={cn(
              "group/day relative flex min-w-0 flex-col items-center gap-1.5 rounded-lg border border-transparent px-0.5 pt-2 pb-1.5 transition-[background-color,border-color,transform] duration-150 ease-fluid outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] hover-fine:bg-muted/50",
              selected && "border-border bg-card shadow-xs hover-fine:bg-card",
            )}
          >
            <span className="flex flex-col items-center leading-none">
              <span
                className={cn(
                  "text-[0.6875rem] font-medium",
                  day.isToday ? "text-primary" : "text-muted-foreground",
                )}
              >
                {day.label}
              </span>
              <span
                className={cn(
                  "relative mt-1 flex size-7 items-center justify-center rounded-full text-base tabular-nums font-semibold tracking-tight",
                  day.isToday ? "bg-primary text-primary-foreground" : "text-foreground",
                )}
              >
                {day.dayNumber}
                {/* Pinned to the date rather than the column corner: on a
                    phone the column is barely wider than the weekday, and a
                    corner badge sat on top of it. */}
                {day.deadlines > 0 && (
                  <span
                    aria-hidden
                    className="absolute -end-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-deficit px-0.5 text-[0.5625rem] font-semibold tabular-nums text-background ring-2 ring-card"
                  >
                    {day.deadlines}
                  </span>
                )}
              </span>
            </span>

            {/* Free time is the outline; booked study is the fill. */}
            <span aria-hidden className="relative flex h-10 w-full max-w-7 items-end justify-center">
              {loading ? (
                <span data-slot="skeleton" className="skeleton block h-full w-full rounded-md" />
              ) : capacity === 0 ? (
                <span className="h-1 w-full rounded-full bg-border" />
              ) : (
                <span
                  className="relative w-full overflow-hidden rounded-md bg-surplus/14 ring-1 ring-surplus/25 ring-inset transition-[height] duration-500 ease-fluid"
                  style={{ height: `${outerHeight}%` }}
                >
                  <span
                    className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-primary transition-[height] duration-500 ease-fluid"
                    style={{ height: `${fillHeight}%` }}
                  />
                </span>
              )}
            </span>

            <span
              aria-hidden
              className="h-3.5 text-[0.6875rem] leading-none tabular-nums text-muted-foreground"
            >
              {loading ? "" : day.planned > 0 ? formatDuration(day.planned) : day.free > 0 ? "–" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The key under the strip. */
export function WeekLoadLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-primary" />
        Study planned
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-surplus/14 ring-1 ring-surplus/25 ring-inset" />
        Free to study
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full bg-deficit" />
        Deadlines
      </span>
    </div>
  );
}
