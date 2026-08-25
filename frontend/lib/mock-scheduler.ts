/**
 * A stand-in for the CP-SAT scheduling engine, running in the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS TEMPORARY. It exists so the session, outcome, revision and progress
 * screens can be built and reviewed before the backend engine lands. Delete
 * this file when `lib/api/scheduling.ts` starts calling real endpoints.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It is deliberately a real scheduler rather than canned fixtures: it obeys
 * every hard rule in SPEC §8.4, so the screens are exercised against plausible
 * data — overlapping windows, unplaceable tails, deadlines that cannot be met.
 * What it does *not* do is search for an optimal plan. It places earliest
 * deadline first (SPEC §10.3) and takes the first fit, where CP-SAT will
 * optimise. Expect the real engine to produce better plans, not different
 * shapes of data.
 */

import { expandWindows, startOfDay, subtractPeriods, type Interval } from "./capacity";
import type { AvailabilityWindow, UnavailablePeriod } from "@/types/availability";
import type { AcademicTask } from "@/types/task";
import type { StudySession } from "@/types/session";
import type { OverloadWarning, UnscheduledWork } from "@/types/schedule";

const DAY_MS = 86_400_000;
/** How far ahead to expand availability when looking for a slot. */
const HORIZON_DAYS = 120;

export interface SchedulerInput {
  tasks: AcademicTask[];
  windows: AvailabilityWindow[];
  periods: UnavailablePeriod[];
  preferredSessionLength: number;
  minimumBreak: number;
  /** Sessions already completed — they never move or reappear (SPEC §14.2). */
  keepSessions?: StudySession[];
  now?: Date;
}

export interface SchedulerResult {
  sessions: StudySession[];
  unscheduledWork: UnscheduledWork[];
  overloadWarnings: OverloadWarning[];
}

/** Subtracts `busy` (already-placed sessions plus their breaks) from `free`. */
function removeBusy(free: Interval[], busy: Interval[]): Interval[] {
  let out = free;
  for (const block of busy) {
    const next: Interval[] = [];
    for (const slot of out) {
      if (block.end <= slot.start || block.start >= slot.end) {
        next.push(slot);
        continue;
      }
      if (block.start > slot.start) next.push({ start: slot.start, end: block.start });
      if (block.end < slot.end) next.push({ start: block.end, end: slot.end });
    }
    out = next;
  }
  return out;
}

const minutes = (interval: Interval) =>
  Math.max(0, (interval.end.getTime() - interval.start.getTime()) / 60_000);

/**
 * Splits a task's remaining minutes into session lengths (SPEC §9.1): whole
 * minutes, exact total preserved, final session allowed to be shorter.
 */
function splitDuration(total: number, preferred: number): number[] {
  const parts: number[] = [];
  let left = Math.max(0, Math.round(total));
  const size = Math.max(1, Math.round(preferred));
  while (left > 0) {
    const take = Math.min(size, left);
    parts.push(take);
    left -= take;
  }
  return parts;
}

export function runMockScheduler({
  tasks,
  windows,
  periods,
  preferredSessionLength,
  minimumBreak,
  keepSessions = [],
  now = new Date(),
}: SchedulerInput): SchedulerResult {
  const horizonEnd = new Date(startOfDay(now).getTime() + HORIZON_DAYS * DAY_MS);

  // Availability, net of unavailable periods and of anything already in the
  // past — a session may never enter the past (SPEC §8.4).
  const baseFree = subtractPeriods(
    expandWindows(windows, startOfDay(now), horizonEnd),
    periods,
  )
    .map((slot) => (slot.start < now ? { start: now, end: slot.end } : slot))
    .filter((slot) => slot.end > slot.start);

  // Completed work holds its ground, and reserves a break either side.
  const busy: Interval[] = keepSessions.map((session) => ({
    start: new Date(new Date(session.startTime).getTime() - minimumBreak * 60_000),
    end: new Date(new Date(session.endTime).getTime() + minimumBreak * 60_000),
  }));

  // Earliest deadline first (SPEC §10.3).
  const open = tasks
    .filter((task) => task.status !== "Completed" && task.remainingDuration > 0)
    .slice()
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  const sessions: StudySession[] = [];
  const unscheduledWork: UnscheduledWork[] = [];
  const overloadWarnings: OverloadWarning[] = [];
  let counter = 0;

  for (const task of open) {
    const deadline = new Date(task.deadline);

    // Capacity that exists for this task at all: free time before its deadline.
    const beforeDeadline = removeBusy(baseFree, busy)
      .map((slot) => (slot.end > deadline ? { start: slot.start, end: deadline } : slot))
      .filter((slot) => slot.end > slot.start);

    const capacity = beforeDeadline.reduce((sum, slot) => sum + minutes(slot), 0);
    let placedMinutes = 0;

    for (const chunk of splitDuration(task.remainingDuration, preferredSessionLength)) {
      const slots = removeBusy(baseFree, busy)
        .map((slot) => (slot.end > deadline ? { start: slot.start, end: deadline } : slot))
        .filter((slot) => slot.end > slot.start)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      const slot = slots.find((candidate) => minutes(candidate) >= chunk);
      if (!slot) break;

      const start = slot.start;
      const end = new Date(start.getTime() + chunk * 60_000);

      sessions.push({
        id: `mock-session-${++counter}`,
        taskId: task.id,
        taskTitle: task.title,
        category: task.category,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        plannedDuration: chunk,
        isAwaitingOutcome: false,
      });

      // Minimum break applies between all consecutive sessions (SPEC §9.3).
      busy.push({ start, end: new Date(end.getTime() + minimumBreak * 60_000) });
      placedMinutes += chunk;
    }

    const shortfall = task.remainingDuration - placedMinutes;
    if (shortfall > 0) {
      const overdue = deadline.getTime() <= now.getTime();
      unscheduledWork.push({
        taskId: task.id,
        taskTitle: task.title,
        remainingMinutes: shortfall,
        reason: overdue
          ? "Its deadline has passed. Give it a new deadline before it can be scheduled."
          : "There is not enough free study time before its deadline.",
      });

      // Proven infeasibility is Overload, not a technical failure (SPEC §10.7).
      if (!overdue) {
        overloadWarnings.push({
          taskId: task.id,
          taskTitle: task.title,
          deadline: task.deadline,
          requiredMinutes: task.remainingDuration,
          availableMinutes: capacity,
          shortfallMinutes: task.remainingDuration - capacity,
          relevantUnavailablePeriods: periods
            .filter((period) => new Date(period.startDate) < deadline && new Date(period.endDate) > now)
            .map((period) => period.title),
        });
      }
    }
  }

  sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return { sessions, unscheduledWork, overloadWarnings };
}
