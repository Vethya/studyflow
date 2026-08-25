"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  Clock3,
  ListChecks,
} from "lucide-react";
import { CapacityBar } from "@/components/capacity-bar";
import { ShortfallCard } from "@/components/shortfall-card";
import { RecordOutcomeDialog } from "@/components/record-outcome-dialog";
import { PendingPlanBanner, SchedulePreview } from "@/components/schedule-preview";
import { UnscheduledWorkList } from "@/components/unscheduled-work-list";
import { formatClock } from "@/lib/datetime";
import { EmptyState, PageHeader, PageShell, SectionHeader, StatTile } from "@/components/page-kit";
import { formatDuration, CATEGORY_CONFIG } from "@/lib/constants";
import { describeDeadline } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  analyseFeasibility,
  assessCapacity,
  availableMinutes,
  startOfDay,
  weeklyPatternMinutes,
} from "@/lib/capacity";
import {
  account as accountApi,
  availability as availabilityApi,
  scheduling,
  tasks as tasksApi,
} from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";
import { useNow } from "@/hooks/use-now";
import type { AcademicTask } from "@/types/task";
import type { StudySession } from "@/types/session";
import type { ScheduleProposal } from "@/types/schedule";

const HORIZONS = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

export default function DashboardPage() {
  const { account } = useSession();
  const now = useNow();
  const [horizon, setHorizon] = useState(7);
  const [outcomeSession, setOutcomeSession] = useState<StudySession | null>(null);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const loadTasks = useCallback((s: AbortSignal) => tasksApi.listTasks({}, s), []);
  const loadWindows = useCallback((s: AbortSignal) => availabilityApi.listWindows(s), []);
  const loadPeriods = useCallback((s: AbortSignal) => availabilityApi.listUnavailablePeriods(s), []);
  const loadPreferences = useCallback((s: AbortSignal) => accountApi.getPreferences(s), []);
  const loadSchedule = useCallback((s: AbortSignal) => scheduling.getActiveSchedule(s), []);
  const loadRevision = useCallback((s: AbortSignal) => scheduling.getPendingRevision(s), []);

  const tasks = useApi(loadTasks);
  const windows = useApi(loadWindows);
  const periods = useApi(loadPeriods);
  const preferences = useApi(loadPreferences);
  const schedule = useApi(loadSchedule);
  const revision = useApi(loadRevision);

  const isLoading = tasks.isLoading || windows.isLoading || periods.isLoading;
  const loadError = tasks.error ?? windows.error ?? periods.error ?? preferences.error;

  const allTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
  const allWindows = useMemo(() => windows.data ?? [], [windows.data]);
  const allPeriods = useMemo(() => periods.data ?? [], [periods.data]);
  const hasWindows = allWindows.length > 0;

  const verdict = useMemo(
    () => assessCapacity(allTasks, allWindows, allPeriods, horizon),
    [allTasks, allWindows, allPeriods, horizon],
  );

  // An overload explanation is per task, not one global figure — a student can
  // be comfortably under capacity overall and still have one task that cannot
  // fit before its own deadline.
  const feasibility = useMemo(
    () => analyseFeasibility(allTasks, allWindows, allPeriods),
    [allTasks, allWindows, allPeriods],
  );
  const overloaded = useMemo(() => feasibility.filter((f) => f.isOverloaded), [feasibility]);

  const todayRemaining = useMemo(() => {
    const endOfDay = new Date(startOfDay(now).getTime() + 24 * 60 * 60_000);
    return availableMinutes(allWindows, allPeriods, now, endOfDay);
  }, [allWindows, allPeriods, now]);

  const openWork = useMemo(
    () => feasibility.reduce((sum, f) => sum + f.requiredMinutes, 0),
    [feasibility],
  );

  const sessions = useMemo(() => schedule.data?.sessions ?? [], [schedule.data]);
  const pendingPlan = revision.data ?? proposal;

  /** The next session that has not started yet (SPEC §17.2). */
  const nextSession = useMemo(() => {
    const from = now.getTime();
    return (
      sessions
        .filter((session) => !session.outcome && new Date(session.startTime).getTime() > from)
        .sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        )[0] ?? null
    );
  }, [sessions, now]);

  /** Past sessions with no recorded outcome (SPEC §12.1). */
  const awaitingOutcome = useMemo(
    () =>
      sessions
        .filter((session) => session.isAwaitingOutcome)
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [sessions],
  );

  /** Study minutes still scheduled between now and midnight (SPEC §17.2). */
  const workloadToday = useMemo(() => {
    const endOfDay = new Date(startOfDay(now).getTime() + 24 * 60 * 60_000);
    return sessions
      .filter((session) => {
        const start = new Date(session.startTime);
        return !session.outcome && start >= now && start < endOfDay;
      })
      .reduce((sum, session) => sum + session.plannedDuration, 0);
  }, [sessions, now]);

  /**
   * Weekly effort progress: minutes worked this week against minutes planned
   * for it. Effort, not content completion (SPEC §13).
   */
  const weeklyEffort = useMemo(() => {
    const start = startOfDay(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000);
    const week = sessions.filter((session) => {
      const at = new Date(session.startTime);
      return at >= start && at < end;
    });
    const planned = week.reduce((sum, session) => sum + session.plannedDuration, 0);
    const worked = week.reduce((sum, session) => sum + (session.actualDuration ?? 0), 0);
    return { planned, worked, percent: planned > 0 ? Math.round((worked / planned) * 100) : 0 };
  }, [sessions, now]);

  /**
   * Unscheduled Work in the SPEC §5.4 sense: open work with no valid session.
   * Distinct from "work still to do", which counts everything remaining.
   */
  const unscheduled = useMemo(() => {
    if (pendingPlan) return pendingPlan.unscheduledWork;
    const scheduled = new Set(
      sessions.filter((session) => !session.outcome).map((session) => session.taskId),
    );
    return allTasks
      .filter(
        (task) =>
          task.status !== "Completed" &&
          task.remainingDuration > 0 &&
          !scheduled.has(task.id),
      )
      .map((task) => ({
        taskId: task.id,
        taskTitle: task.title,
        remainingMinutes: task.remainingDuration,
        reason:
          sessions.length === 0
            ? "You have not made a plan yet."
            : "It has no study session booked.",
      }));
  }, [pendingPlan, sessions, allTasks]);

  const firstName = account?.name.trim().split(/\s+/)[0] ?? "";

  function reloadAll() {
    tasks.reload();
    windows.reload();
    periods.reload();
    schedule.reload();
    revision.reload();
  }

  return (
    <PageShell>
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : "Dashboard"}
        description="Whether your coursework fits the time you have."
      />

      {loadError && (
        <Callout
          tone="danger"
          title="Could not load your dashboard"
          actions={
            <Button variant="outline" size="sm" onClick={reloadAll}>
              Try again
            </Button>
          }
        >
          {describeError(loadError)}
        </Callout>
      )}

      {pendingPlan && (
        <PendingPlanBanner
          proposal={pendingPlan}
          onReview={() => {
            setProposal(pendingPlan);
            setPreviewOpen(true);
          }}
        />
      )}

      {/* SPEC §12.1: prompt for outcomes rather than guessing them. */}
      {awaitingOutcome.length > 0 && (
        <Callout
          tone="warning"
          icon={CalendarClock}
          title={`${awaitingOutcome.length} ${
            awaitingOutcome.length === 1 ? "session is" : "sessions are"
          } waiting on you`}
          actions={
            <Button size="sm" onClick={() => setOutcomeSession(awaitingOutcome[0])}>
              Record what happened
            </Button>
          }
        >
          Until you say how {awaitingOutcome.length === 1 ? "it" : "they"} went, that work
          still counts as remaining.
        </Callout>
      )}


      {/* ── What happens next (SPEC §17.2) ─────────────────── */}
      <NextSession
        session={nextSession}
        isLoading={schedule.isLoading}
        workloadToday={workloadToday}
        hasSessions={sessions.length > 0}
      />

      {/* ── The verdict: the one loud thing on the page ─────── */}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Capacity over the next
          </h2>
          <div
            className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
            role="group"
            aria-label="Time range"
          >
            {HORIZONS.map((option) => (
              <button
                key={option.days}
                onClick={() => setHorizon(option.days)}
                aria-pressed={horizon === option.days}
                className={cn(
                  "rounded-[0.4rem] px-2.5 py-1 text-xs font-medium transition-colors",
                  horizon === option.days
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-14 w-72" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !hasWindows ? (
          <EmptyState
            icon={CalendarOff}
            title="No study time set yet"
            action={
              <Button size="sm" nativeButton={false} render={<Link href="/availability" />}>
                Set your availability
              </Button>
            }
          >
            StudyFlow weighs your coursework against the hours you are actually free.
            Add your weekly hours and this becomes a real answer.
          </EmptyState>
        ) : (
          <>
            <Verdict balance={verdict.balance} count={verdict.tasks.length} days={horizon} />
            <CapacityBar available={verdict.available} committed={verdict.committed} />
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Times shown in {preferences.data?.timezone ?? "your timezone"}.{" "}
              <Link
                href="/availability"
                className="font-medium underline underline-offset-2 hover:text-foreground"
              >
                Change your hours
              </Link>
            </p>
          </>
        )}
      </section>

      {/* ── Glanceable figures ─────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Clock3}
          value={isLoading ? null : formatDuration(todayRemaining)}
          label="Free today"
        />
        <StatTile
          icon={CalendarDays}
          value={isLoading ? null : formatDuration(weeklyPatternMinutes(allWindows))}
          label="Study time each week"
        />
        <StatTile
          icon={ListChecks}
          value={isLoading ? null : formatDuration(openWork)}
          label="Work still to do"
          hint={
            unscheduled.length > 0
              ? `${formatDuration(
                  unscheduled.reduce((sum, item) => sum + item.remainingMinutes, 0),
                )} unplanned`
              : undefined
          }
        />
        <StatTile
          icon={AlertTriangle}
          value={isLoading ? null : String(overloaded.length)}
          label="Tasks that don't fit"
          tone={overloaded.length > 0 ? "deficit" : undefined}
        />
      </div>

      {/* ── Weekly effort progress (SPEC §17.2, §13) ───────── */}
      {sessions.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-medium">This week&rsquo;s effort</h2>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">
                {formatDuration(weeklyEffort.worked)}
              </span>{" "}
              worked of {formatDuration(weeklyEffort.planned)} planned
            </p>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/70 transition-[width]"
              style={{ width: `${Math.min(100, weeklyEffort.percent)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Effort means time put in, not how much of the work is finished.
          </p>
        </section>
      )}

      {/* ── Working area ───────────────────────────────────── */}
      <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
        <section className="min-w-0">
          <SectionHeader
            title="Upcoming deadlines"
            meta={`next ${horizon} days`}
            action={{ href: "/tasks", label: "All tasks" }}
          />
          {isLoading ? (
            <div className="space-y-2 pt-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : verdict.tasks.length === 0 ? (
            <p className="pt-4 text-sm text-muted-foreground">
              Nothing due in this window. Widen the range above, or add a task.
            </p>
          ) : (
            <ul className="divide-y">
              {verdict.tasks.slice(0, 7).map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </section>

        <section className="min-w-0">
          <SectionHeader
            title="Tasks that don't fit"
            meta={
              !hasWindows
                ? "needs your hours"
                : overloaded.length === 0
                  ? "none"
                  : `${overloaded.length} of ${feasibility.length}`
            }
            tone={overloaded.length > 0 ? "deficit" : undefined}
          />
          <div className="space-y-3 pt-3">
            {isLoading ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : !hasWindows ? (
              <p className="text-sm text-muted-foreground">
                Set your weekly hours and StudyFlow will flag anything that cannot fit.
              </p>
            ) : overloaded.length === 0 ? (
              <Callout tone="success" title="Everything fits">
                Every open task has enough free time before its deadline.
              </Callout>
            ) : (
              overloaded
                .slice(0, 3)
                .map((item) => <ShortfallCard key={item.task.id} item={item} />)
            )}
            {overloaded.length > 3 && (
              <Link
                href="/tasks"
                className="block text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {overloaded.length - 3}
                {" more don’t fit →"}
              </Link>
            )}
          </div>
        </section>
      </div>
      {/* ── Unscheduled Work (SPEC §17.2, §5.4) ────────────── */}
      {unscheduled.length > 0 && (
        <section>
          <SectionHeader
            title="Work with no slot"
            meta={`${unscheduled.length} to resolve`}
            tone="deficit"
          />
          <div className="pt-3">
            <UnscheduledWorkList items={unscheduled.slice(0, 4)} />
          </div>
        </section>
      )}

      <RecordOutcomeDialog
        session={outcomeSession}
        open={outcomeSession !== null}
        onOpenChange={(next) => !next && setOutcomeSession(null)}
        onRecorded={(result) => {
          schedule.reload();
          tasks.reload();
          if (result.revision) {
            setProposal(result.revision);
            setPreviewOpen(true);
          }
          revision.reload();
        }}
      />

      <SchedulePreview
        proposal={proposal}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onAccepted={() => {
          setProposal(null);
          reloadAll();
        }}
        onRejected={() => {
          setProposal(null);
          revision.reload();
        }}
      />
    </PageShell>
  );
}

/**
 * "What happens next?" — the first thing SPEC §17.2 asks the Dashboard to
 * answer, paired with how much study is still booked for today.
 */
function NextSession({
  session,
  isLoading,
  workloadToday,
  hasSessions,
}: {
  session: StudySession | null;
  isLoading: boolean;
  workloadToday: number;
  hasSessions: boolean;
}) {
  if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;

  if (!session) {
    return (
      <Callout
        tone="info"
        icon={CalendarClock}
        title={hasSessions ? "No sessions coming up" : "You have no plan yet"}
        actions={
          <Button size="sm" nativeButton={false} render={<Link href="/calendar" />}>
            {hasSessions ? "Open the calendar" : "Plan my time"}
          </Button>
        }
      >
        {hasSessions
          ? "Everything scheduled is behind you. Generate a new plan when you add more work."
          : "Let StudyFlow work out when to fit your tasks around the hours you are free."}
      </Callout>
    );
  }

  const start = new Date(session.startTime);
  const today = start.toDateString() === new Date().toDateString();
  const when = today
    ? `Today at ${formatClock(start)}`
    : `${start.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "short",
      })} at ${formatClock(start)}`;

  return (
    <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border bg-card p-4 sm:p-5">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">Up next</p>
        <p className="mt-1 truncate font-display text-lg font-bold tracking-tight">
          {session.taskTitle}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {when} · {formatDuration(session.plannedDuration)}
        </p>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-end">
          <p className="text-xs font-medium text-muted-foreground">Left to study today</p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums">
            {formatDuration(workloadToday)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/calendar" />}
        >
          Calendar
        </Button>
      </div>
    </section>
  );
}

function Verdict({ balance, count, days }: { balance: number; count: number; days: number }) {
  if (count === 0) {
    return (
      <div>
        <p className="font-display text-4xl font-bold tracking-tighter sm:text-5xl">Nothing due</p>
        <p className="mt-2 text-sm text-muted-foreground">
          No open work falls in the next {days} days.
        </p>
      </div>
    );
  }

  const over = balance < 0;
  return (
    <div>
      <p
        className={cn(
          "font-display text-4xl font-bold tracking-tighter sm:text-5xl",
          over ? "text-deficit" : "text-surplus",
        )}
      >
        {over ? `${formatDuration(-balance)} short` : `${formatDuration(balance)} spare`}
      </p>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        {over
          ? `${count} ${count === 1 ? "task does" : "tasks do"} not fit in the study time you have over the next ${days} days.`
          : `${count} ${count === 1 ? "task fits" : "tasks fit"} in the next ${days} days, with time to spare.`}
      </p>
    </div>
  );
}

function TaskRow({ task }: { task: AcademicTask }) {
  const due = describeDeadline(task.deadline);
  const category = CATEGORY_CONFIG[task.category];

  return (
    <li>
      <Link
        href={`/tasks/${task.id}`}
        className="flex flex-col gap-1 py-2.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {task.priority === "High" && (
              <Badge variant="outline" className="px-1 py-0 text-[0.625rem]">
                High
              </Badge>
            )}
            <span className="truncate">
              {category.label}
              {task.course ? ` · ${task.course}` : ""}
            </span>
          </p>
        </div>

        <span className="flex shrink-0 items-center gap-3 text-xs sm:contents">
          <span className="tabular-nums text-muted-foreground sm:w-16 sm:text-end">
            {formatDuration(task.remainingDuration)}
          </span>
          <span
            className={cn(
              "flex items-center gap-1 font-medium tabular-nums sm:w-20 sm:justify-end",
              due.urgent ? "text-deficit" : "text-muted-foreground",
            )}
          >
            {/* An icon carries the warning too, so urgency is never colour alone. */}
            {due.overdue && <AlertTriangle className="size-3 shrink-0" aria-hidden />}
            {due.short}
          </span>
        </span>
      </Link>
    </li>
  );
}
