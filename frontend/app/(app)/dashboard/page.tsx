"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { AlertTriangle, CalendarClock, CalendarOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { GettingStarted, WelcomeTour } from "@/components/onboarding";
import { CapacityBar } from "@/components/capacity-bar";
import { ShortfallCard } from "@/components/shortfall-card";
import { RecordOutcomeDialog } from "@/components/record-outcome-dialog";
import { PendingPlanBanner, SchedulePreview } from "@/components/schedule-preview";
import { UnscheduledWorkList } from "@/components/unscheduled-work-list";
import { formatClock } from "@/lib/datetime";
import { applyRecordedOutcome } from "@/lib/outcome-ui";
import { EmptyState, Figure, PageHeader, PageShell } from "@/components/page-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { activeScheduleKey, SWR_KEYS } from "@/lib/swr-keys";
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
  const [addOpen, setAddOpen] = useState(false);

  const loadTasks = useCallback((s: AbortSignal) => tasksApi.listTasks({}, s), []);
  const loadWindows = useCallback((s: AbortSignal) => availabilityApi.listWindows(s), []);
  const loadPeriods = useCallback((s: AbortSignal) => availabilityApi.listUnavailablePeriods(s), []);
  const loadPreferences = useCallback((s: AbortSignal) => accountApi.getPreferences(s), []);
  const loadRevision = useCallback((s: AbortSignal) => scheduling.getPendingRevision(s), []);

  const tasks = useApi(SWR_KEYS.tasks, loadTasks);
  const loadSchedule = useCallback(
    (s: AbortSignal) => scheduling.getActiveSchedule(s, tasks.data ?? []),
    [tasks.data],
  );
  const windows = useApi(SWR_KEYS.availabilityWindows, loadWindows);
  const periods = useApi(SWR_KEYS.unavailablePeriods, loadPeriods);
  const preferences = useApi(SWR_KEYS.studyPreferences, loadPreferences);
  const schedule = useApi(
    activeScheduleKey(tasks.data),
    loadSchedule,
  );
  const revision = useApi(SWR_KEYS.pendingRevision, loadRevision);

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

  const unplannedMinutes = unscheduled.reduce((sum, item) => sum + item.remainingMinutes, 0);

  // SPEC §17.2 asks the Dashboard to say what to do next. For an account with
  // nothing set up, that is the four steps themselves.
  const onboarding = {
    weeklyWindows: allWindows.length,
    openTasks: allTasks.filter((task) => task.status !== "Completed").length,
    plannedSessions: sessions.length,
    recordedOutcomes: sessions.filter((session) => session.outcome !== undefined).length,
  };
  const onboardingReady = !isLoading && !schedule.isLoading && loadError === null;
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
        actions={
          // SPEC §17.2 Quick Add Task, using the same form as Calendar and Tasks.
          <Button onClick={() => setAddOpen(true)}>
            <Plus />
            Add task
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

      <WelcomeTour state={onboarding} ready={onboardingReady} />
      <GettingStarted state={onboarding} ready={onboardingReady} />

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

      {/*
        Two columns: the answer to "does my coursework fit?" on the left at full
        width, and the things that need a decision today in a narrower rail. On
        one column the rail follows, so the verdict still opens the page.
      */}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {/* ── The verdict: the one loud thing on the page ─── */}
          <Card>
            <Tabs
              value={horizon}
              onValueChange={(val) => {
                if (val != null) setHorizon(Number(val));
              }}
              className="flex flex-col gap-(--card-spacing)"
            >
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Capacity over the next
                </CardTitle>
                <CardAction>
                  <TabsList className="h-7 p-0.5" aria-label="Time range">
                    {HORIZONS.map((option) => (
                      <TabsTrigger
                        key={option.days}
                        value={option.days}
                        className="h-6 rounded-[0.35rem] px-2.5 py-0.5 text-xs font-medium"
                      >
                        {option.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </CardAction>
              </CardHeader>

              <TabsContent value={horizon} className="outline-none">
                <CardContent className="flex flex-col gap-5">
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
                      StudyFlow weighs your coursework against the hours you are actually
                      free. Add your weekly hours and this becomes a real answer.
                    </EmptyState>
                  ) : (
                    <>
                      <Verdict
                        balance={verdict.balance}
                        count={verdict.tasks.length}
                        days={horizon}
                      />
                      <CapacityBar available={verdict.available} committed={verdict.committed} />
                    </>
                  )}
                </CardContent>
              </TabsContent>

              {/* Today's figures sit with the verdict rather than floating as
                  separate cards; they are the same question at a smaller scale. */}
              <CardFooter className="grid divide-y border-t p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Figure
                  label="Free today"
                  value={isLoading ? null : formatDuration(todayRemaining)}
                />
                <Figure
                  label="Study time each week"
                  value={isLoading ? null : formatDuration(weeklyPatternMinutes(allWindows))}
                />
                <Figure
                  label="Work still to do"
                  value={isLoading ? null : formatDuration(openWork)}
                  hint={
                    unscheduled.length > 0 ? `${formatDuration(unplannedMinutes)} unplanned` : undefined
                  }
                />
              </CardFooter>
            </Tabs>
          </Card>

          {/* ── Upcoming deadlines ─────────────────────────── */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Upcoming deadlines</CardTitle>
              <CardDescription>Open work due in the next {horizon} days.</CardDescription>
              <CardAction>
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/tasks" />}
                >
                  All tasks
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 px-(--card-spacing)">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 w-full" />
                  ))}
                </div>
              ) : verdict.tasks.length === 0 ? (
                <p className="px-(--card-spacing) text-sm text-muted-foreground">
                  Nothing due in this window. Widen the range above, or add a task.
                </p>
              ) : (
                <ul className="divide-y">
                  {verdict.tasks.slice(0, 7).map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </CardContent>
            {preferences.data?.timezone && (
              <CardFooter className="border-t pt-(--card-spacing) text-xs text-muted-foreground">
                Times shown in {preferences.data.timezone}.{" "}
                <Link
                  href="/availability"
                  className="ms-1 font-medium underline underline-offset-2 hover:text-foreground"
                >
                  Change your hours
                </Link>
              </CardFooter>
            )}
          </Card>

          {/* ── Unscheduled Work (SPEC §17.2, §5.4) ────────── */}
          {unscheduled.length > 0 && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Work with no slot</CardTitle>
                <CardDescription>
                  {formatDuration(unplannedMinutes)} of open work has no study session booked.
                </CardDescription>
                <CardAction>
                  <Badge variant="destructive">{unscheduled.length}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <UnscheduledWorkList items={unscheduled.slice(0, 4)} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Rail: what needs a decision ───────────────────── */}
        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6">
          <NextSession
            session={nextSession}
            isLoading={schedule.isLoading}
            workloadToday={workloadToday}
            hasSessions={sessions.length > 0}
          />

          <Card>
            <CardHeader className={overloaded.length > 0 ? "border-b" : undefined}>
              <CardTitle>Tasks that don&rsquo;t fit</CardTitle>
              <CardAction>
                <Badge variant={overloaded.length > 0 ? "destructive" : "secondary"}>
                  {!hasWindows ? "—" : overloaded.length}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {isLoading ? (
                <Skeleton className="h-24 w-full rounded-lg" />
              ) : !hasWindows ? (
                <p className="text-sm text-muted-foreground">
                  Set your weekly hours and StudyFlow will flag anything that cannot fit.
                </p>
              ) : overloaded.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every open task has enough free time before its deadline.
                </p>
              ) : (
                <>
                  {overloaded.slice(0, 3).map((item) => (
                    <ShortfallCard key={item.task.id} item={item} />
                  ))}
                  {overloaded.length > 3 && (
                    <Link
                      href="/tasks"
                      className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {overloaded.length - 3} more don&rsquo;t fit
                    </Link>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Weekly effort progress (SPEC §17.2, §13) ───── */}
          {sessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>This week&rsquo;s effort</CardTitle>
                <CardDescription>
                  Time put in, not how much of the work is finished.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm">
                  <span className="font-display text-xl font-bold tabular-nums">
                    {formatDuration(weeklyEffort.worked)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    worked of {formatDuration(weeklyEffort.planned)} planned
                  </span>
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70 transition-[width]"
                    style={{ width: `${Math.min(100, weeklyEffort.percent)}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <TaskFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        task={null}
        onSaved={() => {
          toast.success("Task added");
          tasks.reload();
        }}
      />

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
  if (isLoading) return <Skeleton className="h-44 w-full rounded-xl" />;

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{hasSessions ? "No sessions coming up" : "You have no plan yet"}</CardTitle>
          <CardDescription>
            {hasSessions
              ? "Everything scheduled is behind you. Generate a new plan when you add more work."
              : "Let StudyFlow work out when to fit your tasks around the hours you are free."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" nativeButton={false} render={<Link href="/calendar" />}>
            {hasSessions ? "Open the calendar" : "Plan my time"}
          </Button>
        </CardContent>
      </Card>
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
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm font-medium text-muted-foreground">Up next</CardTitle>
        <CardAction>
          <Badge variant="outline">{formatDuration(session.plannedDuration)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="font-display text-lg font-bold leading-tight tracking-tight">
          {session.taskTitle}
        </p>
        <p className="text-sm text-muted-foreground">{when}</p>
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-3 border-t pt-(--card-spacing)">
        <p className="text-xs text-muted-foreground">
          Left to study today{" "}
          <span className="font-medium tabular-nums text-foreground">
            {formatDuration(workloadToday)}
          </span>
        </p>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/calendar" />}>
          Calendar
        </Button>
      </CardFooter>
    </Card>
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
        className="flex flex-col gap-1 px-(--card-spacing) py-2.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3"
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
