"use client";

import { useCallback, useMemo, useState, type ElementType, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { Kbd } from "@/components/ui/kbd";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarOff,
  ChartLine,
  Clock,
  ListChecks,
  ListTodo,
  Plus,
} from "@/components/icons";
import { DashboardFocus } from "@/components/dashboard-focus";
import { DayTimeline } from "@/components/day-timeline";
import { CapacityBar } from "@/components/capacity-bar";
import { RecordOutcomeDialog } from "@/components/record-outcome-dialog";
import { SchedulePreview } from "@/components/schedule-preview";
import { useCommandMenu } from "@/components/command-menu";
import { EffortBar, TaskLine, VerdictBadge } from "@/components/study-kit";
import { addZonedDays, formatDate } from "@/lib/datetime";
import { applyRecordedOutcome } from "@/lib/outcome-ui";
import { PageHeader, PageShell, StatCard } from "@/components/page-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDuration } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { analyseFeasibility, assessCapacity, startOfDay } from "@/lib/capacity";
import { labelSessions } from "@/lib/session-labels";
import { availability as availabilityApi, scheduling, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";
import { useNow } from "@/hooks/use-now";
import { useAccountTimezone } from "@/hooks/use-account-timezone";
import { SWR_KEYS } from "@/lib/swr-keys";
import type { StudySession } from "@/types/session";
import type { ScheduleProposal } from "@/types/schedule";

const HORIZONS = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

const OVERLOAD_LIMIT = 3;

export default function DashboardPage() {
  const timeZone = useAccountTimezone();
  const { account } = useSession();
  const { openNewTask } = useCommandMenu();
  const now = useNow();
  const [horizon, setHorizon] = useState(7);
  const [outcomeSession, setOutcomeSession] = useState<StudySession | null>(null);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const loadTasks = useCallback((s: AbortSignal) => tasksApi.listTasks({}, s), []);
  const loadWindows = useCallback((s: AbortSignal) => availabilityApi.listWindows(s), []);
  const loadPeriods = useCallback((s: AbortSignal) => availabilityApi.listUnavailablePeriods(s), []);
  const loadRevision = useCallback((s: AbortSignal) => scheduling.getPendingRevision(s), []);

  const tasks = useApi(SWR_KEYS.tasks, loadTasks);
  const loadSchedule = useCallback((s: AbortSignal) => scheduling.getActiveSchedule(s), []);
  const windows = useApi(SWR_KEYS.availabilityWindows, loadWindows);
  const periods = useApi(SWR_KEYS.unavailablePeriods, loadPeriods);
  const schedule = useApi(SWR_KEYS.activeSchedule, loadSchedule);
  const revision = useApi(SWR_KEYS.pendingRevision, loadRevision);

  const isLoading = tasks.isLoading || windows.isLoading || periods.isLoading;
  const sessionsLoading = isLoading || schedule.isLoading;
  const loadError = tasks.error ?? windows.error ?? periods.error ?? schedule.error ?? revision.error;

  const allTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
  const allWindows = useMemo(() => windows.data ?? [], [windows.data]);
  const allPeriods = useMemo(() => periods.data ?? [], [periods.data]);
  const hasWindows = allWindows.length > 0;

  const verdict = useMemo(
    () => assessCapacity(allTasks, allWindows, allPeriods, horizon, timeZone),
    [allTasks, allWindows, allPeriods, horizon, timeZone],
  );

  // An overload is per task, not one global figure — a student can be under
  // capacity overall and still have one task that cannot fit before its deadline.
  const overloaded = useMemo(
    () => analyseFeasibility(allTasks, allWindows, allPeriods, timeZone).filter((f) => f.isOverloaded),
    [allTasks, allWindows, allPeriods, timeZone],
  );

  const sessions = useMemo(
    () => labelSessions(schedule.data?.sessions ?? [], tasks.data),
    [schedule.data, tasks.data],
  );
  const pendingPlan = revision.data ?? proposal;

  /** The next session that has not started yet (SPEC §17.2). */
  const nextSession = useMemo(() => {
    const from = now.getTime();
    return (
      sessions
        .filter((session) => !session.outcome && new Date(session.startTime).getTime() > from)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0] ?? null
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
    const endOfDay = addZonedDays(startOfDay(now, timeZone), 1, timeZone);
    return sessions
      .filter((session) => {
        const start = new Date(session.startTime);
        return !session.outcome && start >= now && start < endOfDay;
      })
      .reduce((sum, session) => sum + session.plannedDuration, 0);
  }, [sessions, now, timeZone]);

  /** Minutes worked this week against minutes planned for it — effort, not completion (SPEC §13). */
  const weeklyEffort = useMemo(() => {
    const start = startOfDay(now, timeZone);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = addZonedDays(start, 7, timeZone);
    const week = sessions.filter((session) => {
      const at = new Date(session.startTime);
      return at >= start && at < end;
    });
    const planned = week.reduce((sum, session) => sum + session.plannedDuration, 0);
    const worked = week.reduce((sum, session) => sum + (session.actualDuration ?? 0), 0);
    return { planned, worked, percent: planned > 0 ? Math.round((worked / planned) * 100) : 0 };
  }, [sessions, now, timeZone]);

  /** Unscheduled Work (SPEC §5.4): open work with no valid session. */
  const unscheduled = useMemo(() => {
    if (pendingPlan) return pendingPlan.unscheduledWork;
    const scheduled = new Set(
      sessions.filter((session) => !session.outcome).map((session) => session.taskId),
    );
    return allTasks
      .filter((task) => task.status !== "Completed" && task.remainingDuration > 0 && !scheduled.has(task.id))
      .map((task) => ({ taskId: task.id, remainingMinutes: task.remainingDuration }));
  }, [pendingPlan, sessions, allTasks]);

  const unplannedMinutes = unscheduled.reduce((sum, item) => sum + item.remainingMinutes, 0);
  const openTasks = allTasks.filter((task) => task.status !== "Completed").length;
  const firstName = account?.name.trim().split(/\s+/)[0] ?? "";
  const showOverloaded = hasWindows && overloaded.length > 0;
  // The focus card already asks for outcomes unless a pending plan outranks them.
  const focusAsksForOutcomes = hasWindows && openTasks > 0 && pendingPlan === null;
  const showAwaiting = awaitingOutcome.length > 0 && !focusAsksForOutcomes;
  const needsAttention = showAwaiting || showOverloaded || unscheduled.length > 0;
  const showAttention = !isLoading && !loadError && needsAttention;
  const dueSoon = allTasks.filter((task) => {
    const due = new Date(task.deadline).getTime() - now.getTime();
    return task.status !== "Completed" && due >= 0 && due < 7 * 24 * 60 * 60 * 1000;
  }).length;

  function reloadAll() {
    tasks.reload();
    windows.reload();
    periods.reload();
    schedule.reload();
    revision.reload();
  }

  function openPendingPlan() {
    /* c8 ignore next -- the review action only shows while a plan is pending. */
    if (!pendingPlan) return;
    setProposal(pendingPlan);
    setPreviewOpen(true);
  }

  return (
    <PageShell className="dashboard-page gap-4 @4xl/dashboard:h-full @4xl/dashboard:min-h-[40rem] @4xl/dashboard:py-5">
      <PageHeader
        eyebrow={formatDate(now, timeZone, { weekday: "long", day: "numeric", month: "long" })}
        title={firstName ? `${greetingFor(now, timeZone)}, ${firstName}` : "Dashboard"}
        actions={
          <Button onClick={openNewTask} aria-keyshortcuts="N">
            <Plus className="size-4" aria-hidden /> Add a task
            <Kbd aria-hidden className="ms-1 hidden border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground @2xl/dashboard:inline-flex">N</Kbd>
          </Button>
        }
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

      {!loadError && (
        <div className="rise-in grid min-w-0 shrink-0 grid-cols-2 gap-4 @4xl/dashboard:grid-cols-4">
          <StatCard
            icon={Clock}
            label="Left today"
            value={sessionsLoading ? null : workloadToday > 0 ? formatDuration(workloadToday) : "None"}
            hint={workloadToday > 0 ? "Booked for later today" : "Nothing booked"}
          />
          <StatCard
            icon={ListChecks}
            label="Open tasks"
            value={isLoading ? null : openTasks}
            hint={`${dueSoon} due this week`}
          />
          <StatCard
            icon={ChartLine}
            label="Studied this week"
            value={sessionsLoading ? null : formatDuration(weeklyEffort.worked)}
            hint={
              weeklyEffort.planned > 0
                ? `${weeklyEffort.percent}% of ${formatDuration(weeklyEffort.planned)} planned`
                : "Nothing planned yet"
            }
          >
            {weeklyEffort.planned > 0 && (
              <EffortBar
                label="Weekly effort"
                worked={Math.min(weeklyEffort.worked, weeklyEffort.planned)}
                remaining={Math.max(0, weeklyEffort.planned - weeklyEffort.worked)}
              />
            )}
          </StatCard>
          <StatCard
            icon={CalendarClock}
            label="To record"
            value={sessionsLoading ? null : awaitingOutcome.length}
            tone={awaitingOutcome.length > 0 ? "deficit" : undefined}
            hint={awaitingOutcome.length > 0 ? "Past sessions waiting" : "All caught up"}
          />
        </div>
      )}

      {/*
        On a laptop the dashboard is one screen: this grid takes the height that
        is left and each list scrolls inside its own card instead of the page.
      */}
      <div className="grid min-w-0 gap-4 @4xl/dashboard:min-h-0 @4xl/dashboard:flex-1 @4xl/dashboard:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 @4xl/dashboard:min-h-0">
          {!loadError && (
            <div className="rise-in shrink-0">
              <DashboardFocus
                ready={!sessionsLoading && !revision.isLoading}
                hasWindows={hasWindows}
                openTasks={openTasks}
                pendingPlan={pendingPlan !== null}
                awaitingOutcome={awaitingOutcome.length}
                nextSession={nextSession}
                onReview={openPendingPlan}
                onRecord={() => setOutcomeSession(awaitingOutcome[0])}
                now={now}
              />
            </div>
          )}

          <Card className="min-w-0 @4xl/dashboard:min-h-0 @4xl/dashboard:flex-1">
            <Tabs
              value={horizon}
              onValueChange={(val) => {
                if (val != null) setHorizon(Number(val));
              }}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <CardHeader>
                <CardTitle>Coming up</CardTitle>
                <CardAction>
                  <TabsList className="h-7" aria-label="Time range">
                    {HORIZONS.map((option) => (
                      <TabsTrigger key={option.days} value={option.days} className="px-2 text-xs">
                        {option.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </CardAction>
              </CardHeader>

              <TabsContent
                value={horizon}
                className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
              >
                <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                  {isLoading ? (
                    <div className="space-y-2 p-4">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-11 w-full" />
                      ))}
                    </div>
                  ) : (
                    <>
                      {!hasWindows ? (
                        <NoStudyTime />
                      ) : (
                        verdict.tasks.length > 0 && (
                          <div className="flex shrink-0 flex-col gap-2.5 border-b px-4 py-3">
                            <Verdict
                              balance={verdict.balance}
                              count={verdict.tasks.length}
                              committed={verdict.committed}
                              available={verdict.available}
                            />
                            <CapacityBar size="sm" available={verdict.available} committed={verdict.committed} />
                          </div>
                        )
                      )}
                      {verdict.tasks.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground">Nothing due in the next {horizon} days.</p>
                      ) : (
                        <ul aria-label="Tasks coming up" className="min-h-0 flex-1 divide-y @4xl/dashboard:overflow-y-auto">
                          {verdict.tasks.map((task) => (
                            <TaskLine key={task.id} task={task} className="[--card-spacing:--spacing(4)]" />
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </CardContent>
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4 @4xl/dashboard:min-h-0">
          <Card className={cn("rise-in min-w-0 @4xl/dashboard:min-h-0 @4xl/dashboard:flex-1", loadError && "@4xl/dashboard:col-span-2")} style={{ "--stagger": 1 } as React.CSSProperties}>
            <CardHeader>
              <CardTitle>Today</CardTitle>
              <CardAction>
                <Button variant="ghost" size="xs" nativeButton={false} render={<Link href="/calendar" />}>
                  Calendar <ArrowRight aria-hidden />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="min-h-0 px-0 py-3 [--card-spacing:--spacing(3)] @4xl/dashboard:overflow-y-auto">
              <DayTimeline
                sessions={sessions}
                now={now}
                timeZone={timeZone}
                isLoading={sessionsLoading}
                hasPlan={sessions.length > 0}
                onRecord={setOutcomeSession}
              />
            </CardContent>
          </Card>

          {showAttention && (
            <Card className="min-w-0 shrink-0 @4xl/dashboard:max-h-[55%]">
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 p-0 @4xl/dashboard:overflow-y-auto">
                <ul className="divide-y">
                  {showAwaiting && (
                    <AttentionRow
                      icon={CalendarClock}
                      title="Record your past sessions"
                      detail={`${awaitingOutcome.length} waiting`}
                      action={
                        <Button size="xs" variant="outline" onClick={() => setOutcomeSession(awaitingOutcome[0])}>
                          Record what happened
                        </Button>
                      }
                    />
                  )}
                  {showOverloaded &&
                    overloaded.slice(0, OVERLOAD_LIMIT).map((item) => (
                      <AttentionRow
                        key={item.task.id}
                        icon={AlertTriangle}
                        title={
                          <Link href={`/tasks/${item.task.id}`} className="underline-offset-4 hover:underline">
                            {item.task.title}
                          </Link>
                        }
                        detail={`${formatDuration(item.shortfallMinutes)} short · due ${formatDate(item.task.deadline, timeZone, { day: "numeric", month: "short" })}`}
                        action={
                          <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/tasks/${item.task.id}`} />}>
                            Fix
                          </Button>
                        }
                      />
                    ))}
                  {showOverloaded && overloaded.length > OVERLOAD_LIMIT && (
                    <li className="px-4 py-2">
                      <Link
                        href="/tasks"
                        className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {overloaded.length - OVERLOAD_LIMIT} more
                      </Link>
                    </li>
                  )}
                  {unscheduled.length > 0 && (
                    <AttentionRow
                      icon={ListTodo}
                      title={`${unscheduled.length} ${unscheduled.length === 1 ? "task has" : "tasks have"} no session yet`}
                      detail={`${formatDuration(unplannedMinutes)} to plan`}
                      action={
                        <Button size="xs" variant="outline" nativeButton={false} render={<Link href="/calendar" />}>
                          Plan my time
                        </Button>
                      }
                    />
                  )}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <RecordOutcomeDialog
        session={outcomeSession}
        open={outcomeSession !== null}
        onOpenChange={(next) => !next && setOutcomeSession(null)}
        onRecorded={(result) => {
          if (schedule.data) {
            schedule.setData({
              ...schedule.data,
              sessions: schedule.data.sessions.map((session) =>
                session.id === result.session.id ? result.session : session,
              ),
            });
          }
          applyRecordedOutcome(result, { setProposal, setPreviewOpen });
        }}
      />

      <SchedulePreview
        proposal={proposal}
        availabilityWindows={allWindows}
        unavailablePeriods={allPeriods}
        existingSessions={sessions}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onAccepted={() => {
          setProposal(null);
          revision.setData(null);
        }}
        onRejected={() => {
          setProposal(null);
          revision.setData(null);
        }}
      />
    </PageShell>
  );
}

function greetingFor(now: Date, timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** One thing that needs a decision, as a single row with its fix beside it. */
function AttentionRow({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: ElementType;
  title: ReactNode;
  detail: string;
  action: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-deficit/12 text-deficit" aria-hidden>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}

function NoStudyTime() {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-frame" aria-hidden>
        <CalendarOff className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium">No study time set yet</p>
        <p className="text-xs text-muted-foreground">Add your weekly hours to see if your work fits.</p>
      </div>
      <Button size="sm" nativeButton={false} render={<Link href="/availability" />}>
        Set my study hours
      </Button>
    </div>
  );
}

function Verdict({
  balance,
  count,
  committed,
  available,
}: {
  balance: number;
  count: number;
  committed: number;
  available: number;
}) {
  const over = balance < 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <VerdictBadge tone={over ? "over" : "fits"}>{over ? "Doesn’t fit yet" : "On track"}</VerdictBadge>
      <p className={cn("text-xl font-semibold tracking-tight tabular-nums", over ? "text-deficit" : "text-surplus")}>
        {over ? `${formatDuration(-balance)} short` : `${formatDuration(balance)} spare`}
      </p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {over
          ? `${count} ${count === 1 ? "task does" : "tasks do"} not fit`
          : `${count} ${count === 1 ? "task" : "tasks"} due`}
        {` · ${formatDuration(committed)} of work, ${formatDuration(available)} of study time`}
      </p>
    </div>
  );
}
