"use client";

import * as React from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DetailDrawer } from "@/components/detail-drawer";
import { OverloadWarningList } from "@/components/overload-warning-list";
import { UnscheduledWorkList } from "@/components/unscheduled-work-list";
import { DAY_NAMES_SHORT, formatDuration } from "@/lib/constants";
import {
  addZonedDays,
  dayKey,
  formatClock,
  formatDate,
  inTimeZone,
  minutesSinceMidnight,
  startOfZonedDay,
} from "@/lib/datetime";
import { scheduling } from "@/lib/api";
import { expandUnavailablePeriods, expandWindows, subtractPeriods } from "@/lib/capacity";
import { describeError, useApi } from "@/hooks/use-api";
import { SWR_KEYS } from "@/lib/swr-keys";
import { GridLegend, WeekGrid, type GridBlock, type GridColumn } from "@/components/week-grid";
import type { AvailabilityWindow, UnavailablePeriod } from "@/types/availability";
import type { ScheduleProposal, ScheduleScenario } from "@/types/schedule";
import type { SessionOutcome, StudySession } from "@/types/session";
import { useAccountTimezone } from "@/hooks/use-account-timezone";

const DEFAULT_RANGE = { start: 8, end: 22 };

function startOfWeek(date: Date, timeZone: string): Date {
  const start = startOfZonedDay(date, timeZone);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function formatWeekRange(start: Date, timeZone: string): string {
  const end = addZonedDays(start, 6, timeZone);
  const startLabel = formatDate(start, timeZone, { day: "numeric", month: "short" });
  const endLabel = formatDate(end, timeZone, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

function describeScenario(scenario: ScheduleScenario): string | null {
  const assumptions = [
    scenario.temporaryAvailability.length > 0
      ? `${scenario.temporaryAvailability.length} temporary study window${scenario.temporaryAvailability.length === 1 ? "" : "s"}`
      : null,
    scenario.temporaryBlockedPeriods.length > 0
      ? `${scenario.temporaryBlockedPeriods.length} temporary block${scenario.temporaryBlockedPeriods.length === 1 ? "" : "s"}`
      : null,
    scenario.deadlineOverrides.length > 0
      ? `${scenario.deadlineOverrides.length} hypothetical deadline${scenario.deadlineOverrides.length === 1 ? "" : "s"}`
      : null,
  ].filter((assumption): assumption is string => assumption !== null);
  return assumptions.length > 0 ? assumptions.join(" · ") : null;
}

/**
 * Preview and accept-or-reject a proposed plan (SPEC §11.2, §14.2).
 *
 * Acceptance is all-or-nothing by design, not by omission: partial acceptance
 * can invalidate the feasibility guarantees the scheduler just proved
 * (SPEC §14.3). The buttons say so plainly rather than offering per-session
 * controls that would have to be taken away again.
 */
export function SchedulePreview({
  proposal,
  open,
  onOpenChange,
  onAccepted,
  onRejected,
  availabilityWindows,
  unavailablePeriods,
  existingSessions: existingSessionsProp,
}: {
  proposal: ScheduleProposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: () => void;
  onRejected: () => void;
  availabilityWindows?: AvailabilityWindow[];
  unavailablePeriods?: UnavailablePeriod[];
  existingSessions?: StudySession[];
}) {
  const timeZone = useAccountTimezone();
  const [busy, setBusy] = React.useState<"accept" | "reject" | null>(null);

  const loadActiveSessions = React.useCallback(
    (s: AbortSignal) => scheduling.listSessions(s),
    [],
  );
  const activeSessionsQuery = useApi(
    open && !existingSessionsProp ? SWR_KEYS.activeSchedule : null,
    loadActiveSessions,
  );
  const existingSessions = existingSessionsProp ?? activeSessionsQuery.data ?? [];

  // Keep the dialog root mounted before the first proposal is available. This
  // gives Base UI a closed-to-open transition instead of mounting open.
  if (!proposal) {
    return (
      <DetailDrawer
        open={false}
        onOpenChange={onOpenChange}
        size="wide"
        title="Your proposed plan"
      >
        {null}
      </DetailDrawer>
    );
  }

  const upcoming = proposal.proposedSessions
    .filter((session) => !session.outcome && new Date(session.endTime) > new Date())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const totalMinutes = upcoming.reduce((sum, session) => sum + session.plannedDuration, 0);
  const scenarioDescription = proposal.scenario ? describeScenario(proposal.scenario) : null;
  // Overloaded tasks already show their unplaced work with the full explanation.
  const overloadedTaskIds = new Set(proposal.overloadWarnings.map((warning) => warning.taskId));
  const unexplainedUnscheduled = proposal.unscheduledWork.filter(
    (item) => !overloadedTaskIds.has(item.taskId),
  );

  const now = new Date();
  const recordedSessions = existingSessions.filter(
    (s) => s.outcome === "Missed" || s.outcome === "Delayed",
  );
  const activeUpcoming = existingSessions.filter(
    (s) => !s.outcome && new Date(s.startTime) > now,
  );
  const missedCount = recordedSessions.filter((s) => s.outcome === "Missed").length;
  const delayedCount = recordedSessions.filter((s) => s.outcome === "Delayed").length;

  async function run(action: "accept" | "reject") {
    setBusy(action);
    try {
      if (action === "accept") {
        // The SWR schedule cache is revalidated by the successful mutation;
        // this UI already reloads its mounted schedule after the callback.
        await scheduling.acceptProposal(proposal!.id, undefined, false);
        toast.success("Plan accepted");
        onAccepted();
      } else {
        await scheduling.rejectProposal(proposal!.id);
        toast.success("Plan discarded — nothing changed");
        onRejected();
      }
      onOpenChange(false);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title={proposal.reason ? "A new plan for you" : "Your proposed plan"}
      description={
        proposal.reason
          ? undefined
          : `${upcoming.length} ${upcoming.length === 1 ? "session" : "sessions"} · ${formatDuration(
              totalMinutes,
            )} of study`
      }
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => void run("reject")}
            disabled={busy !== null}
          >
            {busy === "reject" && <Loader2 className="animate-spin" />}
            Discard
          </Button>
          <Button onClick={() => void run("accept")} disabled={busy !== null}>
            {busy === "accept" && <Loader2 className="animate-spin" />}
            Use this plan
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* SPEC §14.2: a revision must say why it was generated. */}
        {proposal.reason && (
          <Callout tone="info" title="Why this changed">
            {proposal.reason}
          </Callout>
        )}

        {scenarioDescription && (
          <Callout tone="info" title="Based on temporary assumptions">
            {scenarioDescription}
          </Callout>
        )}

        {/* Replacement and adjustment summary banner */}
        {proposal.reason && (
          <Callout tone="info" title="Schedule adjustment summary">
            {activeUpcoming.length > 0 ? (
              <div className="space-y-2">
                <p>
                  Using this plan will replace{" "}
                  <strong className="font-semibold text-foreground">
                    {activeUpcoming.length} upcoming {activeUpcoming.length === 1 ? "session" : "sessions"}
                  </strong>{" "}
                  with{" "}
                  <strong className="font-semibold text-foreground">
                    {upcoming.length} newly proposed recovery {upcoming.length === 1 ? "session" : "sessions"}
                  </strong>
                  . Recorded sessions ({[
                    missedCount > 0 ? `${missedCount} missed` : null,
                    delayedCount > 0 ? `${delayedCount} partly done` : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "historical sessions"}
                  ) remain unchanged in your history.
                </p>
                <div className="rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Upcoming sessions being replaced:</span>
                  <ul className="mt-1 space-y-1 pl-3 list-disc">
                    {activeUpcoming.slice(0, 5).map((s) => {
                      const start = inTimeZone(s.startTime, timeZone);
                      const dateStr = `${DAY_NAMES_SHORT[start.getDay()]} ${start.getDate()} ${formatDate(start, timeZone, { month: "short" })}`;
                      return (
                        <li key={s.id}>
                          <span className="font-medium text-foreground">{s.taskTitle ?? "Scheduled study"}</span>
                          {" — "}
                          <span>
                            {dateStr}, {formatClock(start, timeZone)} ({formatDuration(s.plannedDuration)})
                          </span>
                        </li>
                      );
                    })}
                    {activeUpcoming.length > 5 && (
                      <li className="list-none pt-0.5 text-muted-foreground/80 italic">
                        ...and {activeUpcoming.length - 5} more upcoming {activeUpcoming.length - 5 === 1 ? "session" : "sessions"}
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            ) : (
              <p>
                Using this plan will add{" "}
                <strong className="font-semibold text-foreground">
                  {upcoming.length} newly proposed recovery {upcoming.length === 1 ? "session" : "sessions"}
                </strong>{" "}
                to recover your study time. Recorded sessions remain unchanged in your history.
              </p>
            )}
          </Callout>
        )}

        {/* SPEC §10.5 / §11.2: the full Overload explanation for each affected task. */}
        {proposal.overloadWarnings.length > 0 && (
          <section className="space-y-2">
            <Callout
              tone="warning"
              title={`${proposal.overloadWarnings.length} ${
                proposal.overloadWarnings.length === 1 ? "task still doesn’t" : "tasks still don’t"
              } fit`}
            >
              Using this plan still places everything that fits. To fit the rest, move a deadline
              or add study time.
            </Callout>
            <OverloadWarningList warnings={proposal.overloadWarnings} />
          </section>
        )}

        {unexplainedUnscheduled.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Work with no slot</h3>
            <UnscheduledWorkList items={unexplainedUnscheduled} />
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-medium">
            {upcoming.length === 0 ? "No sessions" : "Sessions"}
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              StudyFlow could not place any sessions. Add study time or move a deadline, then
              try again.
            </p>
          ) : (
            <ProposalCalendar
              key={proposal.id}
              isRecoveryProposal={Boolean(proposal.reason)}
              proposedSessions={upcoming}
              recordedSessions={recordedSessions}
              availabilityWindows={availabilityWindows}
              unavailablePeriods={unavailablePeriods}
            />
          )}
        </section>

        <p className="text-xs text-muted-foreground">
          Using this plan replaces all of your upcoming sessions. Sessions you have already
          recorded stay exactly as they are.
        </p>
      </div>
    </DetailDrawer>
  );
}

interface CalendarSessionItem {
  id: string;
  taskId: string;
  taskTitle: string;
  startTime: string;
  endTime: string;
  plannedDuration: number;
  actualDuration?: number;
  outcome?: SessionOutcome;
  tone: "default" | "proposed" | "missed" | "delayed" | "completed";
  badge?: string;
}

export function ProposalCalendar({
  isRecoveryProposal,
  proposedSessions,
  recordedSessions,
  availabilityWindows,
  unavailablePeriods,
}: {
  isRecoveryProposal: boolean;
  proposedSessions: StudySession[];
  recordedSessions: StudySession[];
  availabilityWindows?: AvailabilityWindow[];
  unavailablePeriods?: UnavailablePeriod[];
}) {
  const timeZone = useAccountTimezone();
  const allSessions: CalendarSessionItem[] = React.useMemo(() => {
    const list: CalendarSessionItem[] = [];

    for (const session of proposedSessions) {
      list.push({
        id: session.id,
        taskId: session.taskId,
        taskTitle: session.taskTitle,
        startTime: session.startTime,
        endTime: session.endTime,
        plannedDuration: session.plannedDuration,
        actualDuration: session.actualDuration,
        outcome: session.outcome,
        tone: isRecoveryProposal ? "proposed" : "default",
        badge: isRecoveryProposal ? "Proposed" : undefined,
      });
    }

    for (const session of recordedSessions) {
      const outcome = session.outcome;
      list.push({
        id: session.id,
        taskId: session.taskId,
        taskTitle: session.taskTitle,
        startTime: session.startTime,
        endTime: session.endTime,
        plannedDuration: session.plannedDuration,
        actualDuration: session.actualDuration,
        outcome,
        tone:
          outcome === "Missed"
            ? "missed"
            : outcome === "Delayed"
              ? "delayed"
              : "completed",
        badge:
          outcome === "Missed"
            ? "Missed"
            : outcome === "Delayed"
              ? "Partly done"
              : "Completed",
      });
    }

    return list.sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
  }, [isRecoveryProposal, proposedSessions, recordedSessions]);

  const earliestWeek = React.useMemo(() => {
    if (allSessions.length === 0) return startOfWeek(new Date(), timeZone);
    const earliestSessionWeek = startOfWeek(new Date(allSessions[0].startTime), timeZone);
    const currentWeek = startOfWeek(new Date(), timeZone);
    return earliestSessionWeek.getTime() < currentWeek.getTime()
      ? earliestSessionWeek
      : currentWeek;
  }, [allSessions, timeZone]);

  const defaultAnchor = React.useMemo(() => {
    if (allSessions.length === 0) return startOfWeek(new Date(), timeZone);
    const currentWeek = startOfWeek(new Date(), timeZone);
    const hasCurrentWeek = allSessions.some(
      (s) => startOfWeek(new Date(s.startTime), timeZone).getTime() === currentWeek.getTime(),
    );
    if (hasCurrentWeek) return currentWeek;
    if (proposedSessions.length > 0) {
      return startOfWeek(new Date(proposedSessions[0].startTime), timeZone);
    }
    return currentWeek;
  }, [allSessions, proposedSessions, timeZone]);

  const lastWeek = React.useMemo(() => {
    if (allSessions.length === 0) return startOfWeek(new Date(), timeZone);
    const latestSessionWeek = startOfWeek(
      new Date(allSessions[allSessions.length - 1].startTime),
      timeZone,
    );
    const currentWeek = startOfWeek(new Date(), timeZone);
    return latestSessionWeek.getTime() > currentWeek.getTime()
      ? latestSessionWeek
      : currentWeek;
  }, [allSessions, timeZone]);

  const [anchor, setAnchor] = React.useState(defaultAnchor);

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, index) => addZonedDays(anchor, index, timeZone)),
    [anchor, timeZone],
  );
  const rangeEnd = React.useMemo(
    () => addZonedDays(anchor, 7, timeZone),
    [anchor, timeZone],
  );
  const visibleDays = React.useMemo(() => new Set(days.map((day) => dayKey(day, timeZone))), [days, timeZone]);
  const visibleSessions = React.useMemo(
    () =>
      allSessions.filter((session) => visibleDays.has(dayKey(new Date(session.startTime), timeZone))),
    [allSessions, visibleDays, timeZone],
  );
  const visibleProposalStates = React.useMemo(() => {
    const states = new Set<"proposed" | "missed" | "delayed" | "completed">();
    for (const session of visibleSessions) {
      if (session.outcome === "Missed") states.add("missed");
      else if (session.outcome === "Delayed") states.add("delayed");
      else if (session.outcome === "Completed") states.add("completed");
      else if (isRecoveryProposal) states.add("proposed");
    }
    return [...states];
  }, [visibleSessions, isRecoveryProposal]);
  const freeIntervals = React.useMemo(
    () =>
      subtractPeriods(
        expandWindows(availabilityWindows ?? [], anchor, rangeEnd, timeZone),
        unavailablePeriods ?? [],
      ),
    [availabilityWindows, unavailablePeriods, anchor, rangeEnd, timeZone],
  );
  const blockedIntervals = React.useMemo(
    () => expandUnavailablePeriods(unavailablePeriods ?? [], anchor, rangeEnd, timeZone),
    [unavailablePeriods, anchor, rangeEnd, timeZone],
  );
  const hourRange = React.useMemo(() => {
    const intervals = [
      ...visibleSessions.map((session) => ({
        start: new Date(session.startTime),
        end: new Date(session.endTime),
      })),
      ...freeIntervals,
      ...blockedIntervals,
    ];
    if (intervals.length === 0) return DEFAULT_RANGE;

    let min = 24;
    let max = 0;
    for (const interval of intervals) {
      const start = inTimeZone(interval.start, timeZone);
      const end = inTimeZone(interval.end, timeZone);
      min = Math.min(min, start.getHours());
      max = Math.max(max, end.getHours() + 1);
    }
    return {
      start: Math.max(0, min - 1),
      end: Math.min(24, Math.max(max + 1, min + 6)),
    };
  }, [visibleSessions, freeIntervals, blockedIntervals, timeZone]);
  const columns: GridColumn[] = React.useMemo(() => {
    const today = dayKey(new Date(), timeZone);
    return days.map((day) => ({
      key: dayKey(day, timeZone),
      label: DAY_NAMES_SHORT[inTimeZone(day, timeZone).getDay()],
      sublabel: String(inTimeZone(day, timeZone).getDate()),
      isToday: dayKey(day, timeZone) === today,
    }));
  }, [days, timeZone]);
  const blocks: GridBlock[] = React.useMemo(
    () => {
      const out: GridBlock[] = [];

      const pushIntervals = (
        intervals: { start: Date; end: Date }[],
        variant: "available" | "blocked",
        prefix: string,
      ) => {
        intervals.forEach((interval, index) => {
          for (const day of days) {
            const dayStart = startOfZonedDay(day, timeZone);
            const dayEnd = addZonedDays(dayStart, 1, timeZone);
            const start = interval.start < dayStart ? dayStart : interval.start;
            const end = interval.end > dayEnd ? dayEnd : interval.end;
            if (end <= start) continue;
            out.push({
              id: `${prefix}-${index}-${dayKey(day, timeZone)}`,
              columnKey: dayKey(day, timeZone),
              start: minutesSinceMidnight(start, timeZone),
              end: minutesSinceMidnight(end, timeZone) || 1440,
              variant,
              title: variant === "blocked" ? "Blocked time" : "Free to study",
            });
          }
        });
      };

      pushIntervals(freeIntervals, "available", "free");
      pushIntervals(blockedIntervals, "blocked", "blocked");

      for (const session of visibleSessions) {
        const start = new Date(session.startTime);
        const end = new Date(session.endTime);
        const outcomeDetail =
          session.outcome === "Missed"
            ? " · Missed"
            : session.outcome === "Delayed"
              ? ` · Partly done (${formatDuration(session.actualDuration ?? 0)} recorded)`
              : session.outcome === "Completed"
                ? " · Completed"
                : isRecoveryProposal
                  ? " · Proposed"
                  : "";

        out.push({
          id: session.id,
          columnKey: dayKey(start, timeZone),
          start: minutesSinceMidnight(start, timeZone),
          end: minutesSinceMidnight(end, timeZone) || 1440,
          variant: "session",
          label: session.taskTitle,
          badge: session.badge,
          tone: session.tone,
          settled: session.outcome === "Completed",
          meta: `${formatClock(start, timeZone)}–${formatClock(end, timeZone)}`,
          title: `${session.taskTitle}${outcomeDetail} · ${formatClock(start, timeZone)}–${formatClock(end, timeZone)} · ${formatDuration(session.plannedDuration)}`,
        });
      }

      return out;
    },
    [visibleSessions, freeIntervals, blockedIntervals, days, isRecoveryProposal, timeZone],
  );
  const now = new Date();
  const nowMarker = visibleDays.has(dayKey(now, timeZone))
    ? { columnKey: dayKey(now, timeZone), minutes: minutesSinceMidnight(now, timeZone) }
    : undefined;
  const canGoBack = anchor.getTime() > earliestWeek.getTime();
  const canGoForward = anchor.getTime() < lastWeek.getTime();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatWeekRange(anchor, timeZone)}
        </span>
        <div className="flex items-center rounded-lg border bg-card">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-e-none"
            onClick={() => setAnchor(addZonedDays(anchor, -7, timeZone))}
            disabled={!canGoBack}
            aria-label="Previous week"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-s-none"
            onClick={() => setAnchor(addZonedDays(anchor, 7, timeZone))}
            disabled={!canGoForward}
            aria-label="Next week"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <WeekGrid
        ariaLabel="Proposed sessions"
        columns={columns}
        blocks={blocks}
        hourStart={hourRange.start}
        hourEnd={hourRange.end}
        now={nowMarker}
      />
      <GridLegend
        proposalStates={visibleProposalStates}
        showSession={!isRecoveryProposal}
      />
    </div>
  );
}

/** The banner that surfaces a pending plan from anywhere in the app. */
export function PendingPlanBanner({
  proposal,
  onReview,
}: {
  proposal: ScheduleProposal;
  onReview: () => void;
}) {
  return (
    <Callout
      tone="warning"
      icon={CalendarClock}
      title={proposal.reason ? "Your plan needs updating" : "A new plan is ready"}
      actions={
        <Button size="sm" onClick={onReview}>
          Review it
        </Button>
      }
    >
      {proposal.reason ??
        "StudyFlow worked out a schedule for your open work. Nothing changes until you accept it."}
    </Callout>
  );
}
