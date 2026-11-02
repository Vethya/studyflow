"use client";

import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryTag } from "@/components/page-kit";
import { formatDuration } from "@/lib/constants";
import { dayKey, formatClock } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { StudySession } from "@/types/session";

type Phase = "done" | "waiting" | "now" | "next" | "later";

function phaseOf(session: StudySession, now: Date, nextId: string | undefined): Phase {
  if (session.outcome) return "done";
  if (session.isAwaitingOutcome) return "waiting";
  const start = new Date(session.startTime).getTime();
  const end = new Date(session.endTime).getTime();
  if (start <= now.getTime() && now.getTime() < end) return "now";
  return session.id === nextId ? "next" : "later";
}

/**
 * Today as a ruled timeline: every session booked for the day, in order, with
 * a "now" line between what is behind you and what is ahead. Sessions waiting
 * on an outcome are flagged in place, where the student remembers them.
 */
export function DayTimeline({
  sessions,
  now,
  timeZone,
  isLoading = false,
  hasPlan,
  onRecord,
}: {
  sessions: StudySession[];
  now: Date;
  timeZone: string;
  isLoading?: boolean;
  /** Whether any plan exists at all, to pick the right empty state. */
  hasPlan: boolean;
  onRecord: (session: StudySession) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 px-(--card-spacing)">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const todayKey = dayKey(now, timeZone);
  const today = sessions
    .filter((session) => dayKey(session.startTime, timeZone) === todayKey)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  if (today.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 px-(--card-spacing) py-2">
        <p className="text-sm text-muted-foreground">
          {hasPlan
            ? "Nothing is booked for today. Enjoy the space, or get ahead on something due soon."
            : "No sessions yet. Build a plan and today’s study will line up here."}
        </p>
        <Button size="sm" variant={hasPlan ? "outline" : "default"} nativeButton={false} render={<Link href="/calendar" />}>
          {hasPlan ? "Open the calendar" : <><Sparkles aria-hidden /> Plan my time</>}
        </Button>
      </div>
    );
  }

  const nextId = today.find(
    (session) => !session.outcome && new Date(session.startTime).getTime() > now.getTime(),
  )?.id;
  // The "now" line sits before the first session that has not started yet.
  const nowIndex = today.findIndex((session) => new Date(session.startTime).getTime() > now.getTime());
  const insertAt = nowIndex === -1 ? today.length : nowIndex;
  const hasCurrent = today.some((session) => phaseOf(session, now, nextId) === "now");

  return (
    <ol aria-label="Today’s study sessions" className="relative flex flex-col px-(--card-spacing)">
      {today.map((session, index) => (
        <TimelineEntry
          key={session.id}
          session={session}
          phase={phaseOf(session, now, nextId)}
          timeZone={timeZone}
          now={now}
          showNowBefore={!hasCurrent && index === insertAt}
          last={index === today.length - 1}
          onRecord={onRecord}
        />
      ))}
      {!hasCurrent && insertAt === today.length && <NowLine now={now} timeZone={timeZone} />}
    </ol>
  );
}

function NowLine({ now, timeZone }: { now: Date; timeZone: string }) {
  return (
    <li aria-label={`Now, ${formatClock(now, timeZone)}`} className="flex items-center gap-3 py-1.5">
      <span className="w-11 shrink-0 text-end text-[0.6875rem] font-semibold tabular-nums text-primary">
        {formatClock(now, timeZone)}
      </span>
      <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
        <span className="size-2 rounded-full bg-primary ring-4 ring-primary/15" />
      </span>
      <span aria-hidden className="h-px flex-1 bg-primary/40" />
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-primary">Now</span>
    </li>
  );
}

function TimelineEntry({
  session,
  phase,
  timeZone,
  now,
  showNowBefore,
  last,
  onRecord,
}: {
  session: StudySession;
  phase: Phase;
  timeZone: string;
  now: Date;
  showNowBefore: boolean;
  last: boolean;
  onRecord: (session: StudySession) => void;
}) {
  const minutesLeft = Math.max(
    0,
    Math.round((new Date(session.endTime).getTime() - now.getTime()) / 60_000),
  );
  const status =
    phase === "done"
      ? session.outcome === "Completed"
        ? "Done"
        : session.outcome === "Delayed"
          ? "Partly done"
          : "Missed"
      : phase === "waiting"
        ? "How did it go?"
        : phase === "now"
          ? `In progress · ${formatDuration(minutesLeft)} left`
          : phase === "next"
            ? "Up next"
            : null;

  return (
    <>
      {showNowBefore && <NowLine now={now} timeZone={timeZone} />}
      <li className="group/entry relative flex gap-3">
        <span
          className="w-11 shrink-0 pt-2.5 text-end text-xs tabular-nums text-muted-foreground"
        >
          {formatClock(session.startTime, timeZone)}
        </span>
        <span aria-hidden className="relative flex w-3 shrink-0 flex-col items-center">
          <span
            className={cn(
              "mt-3 flex size-3 shrink-0 items-center justify-center rounded-full border-2 bg-card",
              phase === "done" && "border-transparent bg-surplus text-background",
              phase === "waiting" && "border-deficit",
              phase === "now" && "border-primary bg-primary",
              phase === "next" && "border-primary",
              phase === "later" && "border-border",
            )}
          >
            {phase === "done" && <Check className="size-2" strokeWidth={3} />}
          </span>
          {!last && <span className="mt-1 w-px flex-1 bg-border" />}
        </span>
        <div
          className={cn(
            "mb-2 min-w-0 flex-1 rounded-xl px-3 py-2 transition-colors duration-150",
            phase === "now" && "bg-primary/8 ring-1 ring-primary/20",
            phase === "next" && "bg-muted/60",
            phase === "waiting" && "bg-deficit/6 ring-1 ring-deficit/20",
          )}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p
              className={cn(
                "min-w-0 truncate text-sm font-medium",
                phase === "done" && "text-muted-foreground",
              )}
            >
              {session.taskTitle}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatDuration(session.plannedDuration)}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <CategoryTag category={session.category} />
            {status && (
              <span
                className={cn(
                  "text-xs",
                  phase === "waiting" ? "font-medium text-deficit" : phase === "now" || phase === "next" ? "font-medium text-primary" : "text-muted-foreground",
                )}
              >
                {status}
              </span>
            )}
            {phase === "waiting" && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onRecord(session)}
                className="ms-auto"
                aria-label={`Record what happened in ${session.taskTitle}`}
              >
                Record <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </li>
    </>
  );
}
