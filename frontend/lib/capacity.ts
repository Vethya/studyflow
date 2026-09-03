/**
 * Weighs study time available against study time owed.
 *
 * Everything here is derived from data the backend actually stores: recurring
 * availability windows, one-off unavailable periods, and the planned duration
 * of tasks that are still open. Nothing is estimated or invented.
 *
 * Times are computed in the browser's local zone. Availability windows are
 * stored as local wall-clock times against the account's configured timezone,
 * so a student whose browser and account disagree will see figures shifted by
 * the offset between them — the timezone settings page surfaces that mismatch.
 */

import type { AvailabilityWindow, UnavailablePeriod } from "@/types/availability";
import type { AcademicTask } from "@/types/task";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface Interval {
  start: Date;
  end: Date;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function intervalMinutes(interval: Interval): number {
  return Math.max(0, (interval.end.getTime() - interval.start.getTime()) / MINUTE);
}

export function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((sum, interval) => sum + intervalMinutes(interval), 0);
}

/** Midnight at the start of the day `date` falls in. */
export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Expand recurring weekly windows into concrete intervals covering
 * `[from, to)`. A window whose end time is at or before its start time is
 * treated as crossing midnight, matching the backend's own interpretation.
 */
export function expandWindows(
  windows: AvailabilityWindow[],
  from: Date,
  to: Date,
): Interval[] {
  const intervals: Interval[] = [];
  // Start a day early so a window that began yesterday and crosses midnight
  // still contributes its portion of `from`.
  const first = startOfDay(new Date(from.getTime() - DAY));

  for (let day = new Date(first); day < to; day = new Date(day.getTime() + DAY)) {
    for (const window of windows) {
      if (day.getDay() !== window.dayOfWeek) continue;

      const startMinutes = minutesOf(window.startTime);
      const endMinutes = minutesOf(window.endTime);
      const spansMidnight = endMinutes <= startMinutes;

      const start = new Date(day.getTime() + startMinutes * MINUTE);
      const end = new Date(
        day.getTime() + (spansMidnight ? endMinutes + 24 * 60 : endMinutes) * MINUTE,
      );

      // Clip to the requested range.
      const clipped = {
        start: start < from ? from : start,
        end: end > to ? to : end,
      };
      if (clipped.end > clipped.start) intervals.push(clipped);
    }
  }

  return intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Remove any part of `intervals` that overlaps a blocked-out period. */
export function subtractPeriods(
  intervals: Interval[],
  periods: UnavailablePeriod[],
): Interval[] {
  const blocks = periods
    .map((period) => ({ start: new Date(period.startDate), end: new Date(period.endDate) }))
    .filter((block) => block.end > block.start);

  let remaining = intervals;
  for (const block of blocks) {
    const next: Interval[] = [];
    for (const interval of remaining) {
      // No overlap: keep as-is.
      if (block.end <= interval.start || block.start >= interval.end) {
        next.push(interval);
        continue;
      }
      // Keep whatever falls before and after the block; either may be empty.
      if (block.start > interval.start) next.push({ start: interval.start, end: block.start });
      if (block.end < interval.end) next.push({ start: block.end, end: interval.end });
    }
    remaining = next;
  }
  return remaining;
}

/** Expand dated unavailable periods into day-sized intervals for a calendar grid. */
export function expandUnavailablePeriods(
  periods: UnavailablePeriod[],
  from: Date,
  to: Date,
): Interval[] {
  const intervals: Interval[] = [];

  for (const period of periods) {
    const periodStart = new Date(period.startDate);
    const periodEnd = new Date(period.endDate);
    const start = periodStart > from ? periodStart : from;
    const end = periodEnd < to ? periodEnd : to;
    if (end <= start) continue;

    for (
      let day = startOfDay(start);
      day < end;
      day = new Date(day.getTime() + DAY)
    ) {
      const dayEnd = new Date(day.getTime() + DAY);
      const clippedStart = start > day ? start : day;
      const clippedEnd = end < dayEnd ? end : dayEnd;
      if (clippedEnd > clippedStart) {
        intervals.push({ start: clippedStart, end: clippedEnd });
      }
    }
  }

  const sorted = intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = previous.end > interval.end ? previous.end : interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** Minutes genuinely free for study across `[from, to)`. */
export function availableMinutes(
  windows: AvailabilityWindow[],
  periods: UnavailablePeriod[],
  from: Date,
  to: Date,
): number {
  return totalMinutes(subtractPeriods(expandWindows(windows, from, to), periods));
}

export interface CapacityVerdict {
  /** Study minutes free between now and the horizon. */
  available: number;
  /** Planned minutes for open tasks due before the horizon. */
  committed: number;
  /** Positive when there is room to spare, negative when overcommitted. */
  balance: number;
  /** committed ÷ available, uncapped: above 1 means the work does not fit. */
  load: number;
  tasks: AcademicTask[];
  from: Date;
  to: Date;
}

const OPEN_STATUSES = new Set(["Not Started", "In Progress", "Overdue"]);

/**
 * Compare what is owed to what is free over the next `days`.
 *
 * Only open tasks count, and only those due inside the horizon — work due
 * after it is not competing for this week's hours. Overdue tasks are always
 * included: their deadline has passed but the work has not gone away.
 */
export function assessCapacity(
  tasks: AcademicTask[],
  windows: AvailabilityWindow[],
  periods: UnavailablePeriod[],
  days: number,
  now: Date = new Date(),
): CapacityVerdict {
  const to = new Date(now.getTime() + days * DAY);

  const due = tasks.filter((task) => {
    if (!OPEN_STATUSES.has(task.status)) return false;
    if (task.status === "Overdue") return true;
    return new Date(task.deadline) < to;
  });

  const available = availableMinutes(windows, periods, now, to);
  const committed = due.reduce((sum, task) => sum + task.remainingDuration, 0);

  return {
    available,
    committed,
    balance: available - committed,
    load: available > 0 ? committed / available : committed > 0 ? Infinity : 0,
    tasks: due.sort(
      (a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime(),
    ),
    from: now,
    to,
  };
}

/** Total minutes in the recurring weekly pattern, ignoring exceptions. */
export function weeklyPatternMinutes(windows: AvailabilityWindow[]): number {
  return windows.reduce((sum, window) => {
    const start = minutesOf(window.startTime);
    const end = minutesOf(window.endTime);
    return sum + (end <= start ? end + 24 * 60 - start : end - start);
  }, 0);
}

/** Free minutes per calendar day across `[from, to)`, keyed `YYYY-MM-DD`. */
export function minutesByDay(
  windows: AvailabilityWindow[],
  periods: UnavailablePeriod[],
  from: Date,
  to: Date,
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const interval of subtractPeriods(expandWindows(windows, from, to), periods)) {
    // Attribute an interval to the day it starts on; windows that cross
    // midnight are rare and the whole block belongs to that evening's study.
    const key = dayKey(interval.start);
    byDay.set(key, (byDay.get(key) ?? 0) + intervalMinutes(interval));
  }
  return byDay;
}

/**
 * One task's feasibility, carrying every field SPEC §10.5 requires of an
 * Overload explanation.
 */
export interface TaskFeasibility {
  task: AcademicTask;
  deadline: Date;
  /** Minutes of work still owed. */
  requiredMinutes: number;
  /**
   * Free minutes before this deadline that earlier-deadline work has not
   * already claimed. Capacity is not per-task in isolation: two tasks due
   * the same week compete for the same hours.
   */
  availableMinutes: number;
  /** Positive when the work cannot fit; zero when it fits. */
  shortfallMinutes: number;
  isOverloaded: boolean;
  /** Unavailable Periods that fall between now and this deadline. */
  relevantPeriods: UnavailablePeriod[];
}

/**
 * Earliest-deadline-first feasibility check across all open work.
 *
 * SPEC §10.3 schedules the earliest deadline first, and §10.4 says to place
 * the feasible portion and leave the excess as Unscheduled Work. So capacity
 * is consumed cumulatively: each task is measured against what is left after
 * everything due before it has taken its share. Checking tasks independently
 * would report every one as fitting while the set as a whole does not.
 *
 * This mirrors the fallback heuristic in ADR 0004 rather than CP-SAT, so it
 * is an approximation of what the solver will conclude — good enough to warn
 * a student, not a substitute for the engine.
 */
export function analyseFeasibility(
  tasks: AcademicTask[],
  windows: AvailabilityWindow[],
  periods: UnavailablePeriod[],
  now: Date = new Date(),
): TaskFeasibility[] {
  const open = tasks
    .filter((task) => OPEN_STATUSES.has(task.status))
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  let consumed = 0;
  return open.map((task) => {
    const deadline = new Date(task.deadline);
    // An overdue deadline leaves no runway at all.
    const capacity =
      deadline <= now ? 0 : availableMinutes(windows, periods, now, deadline);
    const free = Math.max(0, capacity - consumed);
    const required = task.remainingDuration;
    consumed += required;

    return {
      task,
      deadline,
      requiredMinutes: required,
      availableMinutes: free,
      shortfallMinutes: Math.max(0, required - free),
      isOverloaded: required > free,
      relevantPeriods: periods.filter((period) => {
        const start = new Date(period.startDate);
        return start < deadline && new Date(period.endDate) > now;
      }),
    };
  });
}

/** Local-date key, `YYYY-MM-DD`. Not UTC — these are wall-clock days. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
