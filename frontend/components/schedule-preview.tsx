"use client";

import * as React from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DetailDrawer } from "@/components/detail-drawer";
import { UnscheduledWorkList } from "@/components/unscheduled-work-list";
import { DAY_NAMES_SHORT, formatDuration } from "@/lib/constants";
import { formatClock } from "@/lib/datetime";
import { scheduling } from "@/lib/api";
import { expandUnavailablePeriods, expandWindows, subtractPeriods } from "@/lib/capacity";
import { describeError } from "@/hooks/use-api";
import { GridLegend, WeekGrid, type GridBlock, type GridColumn } from "@/components/week-grid";
import type { AvailabilityWindow, UnavailablePeriod } from "@/types/availability";
import type { ScheduleProposal } from "@/types/schedule";
import type { StudySession } from "@/types/session";

const DAY_MS = 86_400_000;
const DEFAULT_RANGE = { start: 8, end: 22 };

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function formatWeekRange(start: Date): string {
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const startLabel = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const endLabel = end.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
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
}: {
  proposal: ScheduleProposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: () => void;
  onRejected: () => void;
  availabilityWindows?: AvailabilityWindow[];
  unavailablePeriods?: UnavailablePeriod[];
}) {
  const [busy, setBusy] = React.useState<"accept" | "reject" | null>(null);

  if (!proposal) return null;

  const upcoming = proposal.proposedSessions
    .filter((session) => !session.outcome && new Date(session.endTime) > new Date())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const totalMinutes = upcoming.reduce((sum, session) => sum + session.plannedDuration, 0);

  async function run(action: "accept" | "reject") {
    setBusy(action);
    try {
      if (action === "accept") {
        await scheduling.acceptProposal(proposal!.id);
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
          : `${upcoming.length} sessions · ${formatDuration(totalMinutes)} of study`
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

        {proposal.overloadWarnings.length > 0 && (
          <Callout
            tone="warning"
            title={`${proposal.overloadWarnings.length} ${
              proposal.overloadWarnings.length === 1 ? "task still doesn’t" : "tasks still don’t"
            } fit`}
          >
            Using this plan is still an improvement, but you will need to move a deadline or
            add study time to fit everything.
          </Callout>
        )}

        {proposal.unscheduledWork.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Work with no slot</h3>
            <UnscheduledWorkList items={proposal.unscheduledWork} />
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
              sessions={upcoming}
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

function ProposalCalendar({
  sessions,
  availabilityWindows,
  unavailablePeriods,
}: {
  sessions: StudySession[];
  availabilityWindows?: AvailabilityWindow[];
  unavailablePeriods?: UnavailablePeriod[];
}) {
  const firstWeek = React.useMemo(
    () => startOfWeek(new Date(sessions[0].startTime)),
    [sessions],
  );
  const lastWeek = React.useMemo(
    () => startOfWeek(new Date(sessions[sessions.length - 1].startTime)),
    [sessions],
  );
  const [anchor, setAnchor] = React.useState(firstWeek);

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, index) => new Date(anchor.getTime() + index * DAY_MS)),
    [anchor],
  );
  const rangeEnd = React.useMemo(
    () => new Date(anchor.getTime() + 7 * DAY_MS),
    [anchor],
  );
  const visibleDays = React.useMemo(() => new Set(days.map(dayKey)), [days]);
  const visibleSessions = React.useMemo(
    () =>
      sessions.filter((session) => visibleDays.has(dayKey(new Date(session.startTime)))),
    [sessions, visibleDays],
  );
  const freeIntervals = React.useMemo(
    () =>
      subtractPeriods(
        expandWindows(availabilityWindows ?? [], anchor, rangeEnd),
        unavailablePeriods ?? [],
      ),
    [availabilityWindows, unavailablePeriods, anchor, rangeEnd],
  );
  const blockedIntervals = React.useMemo(
    () => expandUnavailablePeriods(unavailablePeriods ?? [], anchor, rangeEnd),
    [unavailablePeriods, anchor, rangeEnd],
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
      const start = interval.start;
      const end = interval.end;
      min = Math.min(min, start.getHours());
      max = Math.max(max, end.getHours() + 1);
    }
    return {
      start: Math.max(0, min - 1),
      end: Math.min(24, Math.max(max + 1, min + 6)),
    };
  }, [visibleSessions, freeIntervals, blockedIntervals]);
  const columns: GridColumn[] = React.useMemo(() => {
    const today = dayKey(new Date());
    return days.map((day) => ({
      key: dayKey(day),
      label: DAY_NAMES_SHORT[day.getDay()],
      sublabel: String(day.getDate()),
      isToday: dayKey(day) === today,
    }));
  }, [days]);
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
            const dayStart = new Date(day);
            const dayEnd = new Date(dayStart.getTime() + DAY_MS);
            const start = interval.start < dayStart ? dayStart : interval.start;
            const end = interval.end > dayEnd ? dayEnd : interval.end;
            if (end <= start) continue;
            out.push({
              id: `${prefix}-${index}-${dayKey(day)}`,
              columnKey: dayKey(day),
              start: minutesSinceMidnight(start),
              end: minutesSinceMidnight(end) || 1440,
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
        out.push({
          id: session.id,
          columnKey: dayKey(start),
          start: minutesSinceMidnight(start),
          end: minutesSinceMidnight(end) || 1440,
          variant: "session",
          label: session.taskTitle,
          meta: `${formatClock(start)}–${formatClock(end)}`,
          title: `${session.taskTitle} · ${formatClock(start)}–${formatClock(end)} · ${formatDuration(session.plannedDuration)}`,
        });
      }

      return out;
    },
    [visibleSessions, freeIntervals, blockedIntervals, days],
  );
  const now = new Date();
  const nowMarker = visibleDays.has(dayKey(now))
    ? { columnKey: dayKey(now), minutes: minutesSinceMidnight(now) }
    : undefined;
  const canGoBack = anchor.getTime() > firstWeek.getTime();
  const canGoForward = anchor.getTime() < lastWeek.getTime();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatWeekRange(anchor)}
        </span>
        <div className="flex items-center rounded-lg border bg-card">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-e-none"
            onClick={() => setAnchor(new Date(anchor.getTime() - 7 * DAY_MS))}
            disabled={!canGoBack}
            aria-label="Previous week"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-s-none"
            onClick={() => setAnchor(new Date(anchor.getTime() + 7 * DAY_MS))}
            disabled={!canGoForward}
            aria-label="Next week"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <WeekGrid
        columns={columns}
        blocks={blocks}
        hourStart={hourRange.start}
        hourEnd={hourRange.end}
        now={nowMarker}
      />
      {(availabilityWindows !== undefined || unavailablePeriods !== undefined) && (
        <GridLegend showSession />
      )}
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
