"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { CalendarDays, ChartPie, CheckCircle2, Clock, ListTodo, Sparkles, XCircle } from "@/components/icons";
import { cn } from "@/lib/utils";
import { formatDuration, CATEGORY_CONFIG, DAY_NAMES_SHORT } from "@/lib/constants";
import { dayKey, formatClock, formatDate, inTimeZone } from "@/lib/datetime";
import { scheduling, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import {
  CategoryTag,
  EmptyState,
  PageHeader,
  PageShell,
  SectionCard,
} from "@/components/page-kit";
import { EffortBar, StatusDot } from "@/components/study-kit";
import type { Category } from "@/types/task";
import type { EffortProgress, EstimationAccuracy } from "@/types/progress";
import type { StudySession } from "@/types/session";
import { effortProgressKey, SWR_KEYS } from "@/lib/swr-keys";
import { labelSessions } from "@/lib/session-labels";
import { useAccountTimezone } from "@/hooks/use-account-timezone";

const OUTCOME_STYLE = {
  Completed: { label: "Finished", icon: CheckCircle2, tone: "text-surplus", bar: "bg-surplus" },
  Delayed: { label: "Partly done", icon: Clock, tone: "text-muted-foreground", bar: "bg-muted-foreground/45" },
  Missed: { label: "Missed", icon: XCircle, tone: "text-deficit", bar: "bg-deficit" },
} as const;

type Outcome = keyof typeof OUTCOME_STYLE;

/**
 * Effort progress = time worked ÷ (time worked + estimated time remaining).
 *
 * SPEC §13 is emphatic that this measures expected *effort consumed*, not
 * content completion, quality or grade, so the page says that in the student's
 * own words rather than in the spec's.
 */
export default function ProgressPage() {
  const timeZone = useAccountTimezone();
  const loadTasks = useCallback((s: AbortSignal) => tasksApi.listTasks({}, s), []);
  const tasks = useApi(SWR_KEYS.tasks, loadTasks);
  const loadSchedule = useCallback((s: AbortSignal) => scheduling.getActiveSchedule(s), []);
  const schedule = useApi(SWR_KEYS.activeSchedule, loadSchedule);
  // Progress comes from GET /progress; the key still follows tasks and the
  // schedule so it refreshes when either changes.
  const loadEffort = useCallback((s: AbortSignal) => scheduling.listEffortProgress(s), []);
  const effort = useApi(
    effortProgressKey(tasks.data, schedule.data, schedule.isLoading),
    loadEffort,
  );

  const isLoading = tasks.isLoading || effort.isLoading || schedule.isLoading;
  const error = tasks.error ?? effort.error ?? schedule.error;

  const rows = useMemo(() => effort.data ?? [], [effort.data]);
  const sessions = useMemo(
    () => labelSessions(schedule.data?.sessions ?? [], tasks.data),
    [schedule.data, tasks.data],
  );
  // Every row carries the same account-wide summary.
  const accuracy = rows[0]?.estimationAccuracy ?? null;
  const taskById = useMemo(
    () => new Map((tasks.data ?? []).map((task) => [task.id, task])),
    [tasks.data],
  );

  /** Finished sessions, newest first (SPEC §17.6 completed-session history). */
  const history = useMemo(
    () =>
      sessions
        .filter((session) => session.outcome !== undefined)
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [sessions],
  );

  /** The history in day groups, so a week of study reads as a week. */
  const historyByDay = useMemo(() => {
    const groups: { key: string; date: Date; sessions: StudySession[]; minutes: number }[] = [];
    for (const session of history) {
      const key = dayKey(session.startTime, timeZone);
      const last = groups.at(-1);
      if (last && last.key === key) {
        last.sessions.push(session);
        last.minutes += session.actualDuration ?? 0;
      } else {
        groups.push({
          key,
          date: new Date(session.startTime),
          sessions: [session],
          minutes: session.actualDuration ?? 0,
        });
      }
    }
    return groups;
  }, [history, timeZone]);

  const totals = useMemo(() => {
    const worked = rows.reduce((sum, row) => sum + row.actualDuration, 0);
    const remaining = rows.reduce((sum, row) => sum + row.estimatedRemaining, 0);
    return {
      count: rows.length,
      openCount: rows.filter((row) => row.status !== "Completed").length,
      worked,
      remaining,
      percent: worked + remaining > 0 ? Math.round((worked / (worked + remaining)) * 100) : 0,
      sessionsDone: rows.reduce((sum, row) => sum + row.sessionsCompleted, 0),
      sessionsUpcoming: rows.reduce((sum, row) => sum + row.sessionsUpcoming, 0),
    };
  }, [rows]);

  const outcomes = useMemo(() => {
    const counts: Record<Outcome, number> = { Completed: 0, Delayed: 0, Missed: 0 };
    for (const session of history) counts[session.outcome as Outcome] += 1;
    return counts;
  }, [history]);

  /** Worked minutes per category, largest first. */
  const byCategory = useMemo(() => {
    const minutes = new Map<Category, number>();
    for (const row of rows) {
      if (row.actualDuration <= 0) continue;
      const category = taskById.get(row.taskId)?.category ?? "Other";
      minutes.set(category, (minutes.get(category) ?? 0) + row.actualDuration);
    }
    return [...minutes.entries()]
      .map(([category, value]) => ({ category, minutes: value }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [rows, taskById]);

  function reloadAll() {
    tasks.reload();
    effort.reload();
    schedule.reload();
  }

  return (
    <PageShell>
      <PageHeader
        icon={ChartPie}
        eyebrow="Effort"
        title="Progress"
        description="The time you have studied, the work still estimated, and how your sessions went."
        actions={<Button variant="outline" nativeButton={false} render={<Link href="/calendar" />}><CalendarDays className="size-4" />Open calendar</Button>}
      />

      {error && (
        <Callout
          tone="danger"
          title="Could not load your progress"
          actions={
            <Button variant="outline" size="sm" onClick={reloadAll}>
              Try again
            </Button>
          }
        >
          {describeError(error)}
        </Callout>
      )}

      {/* ── The answer: how much effort is in ─────────────── */}
      <Card className="rise-in min-w-0">
        <CardContent className="grid gap-6 @3xl/dashboard:grid-cols-[minmax(0,1fr)_auto] @3xl/dashboard:items-end">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Effort put in</p>
            {isLoading ? (
              <Skeleton className="mt-2 h-10 w-48" />
            ) : (
              <p className="mt-1 text-[2.5rem] leading-none tabular-nums font-semibold tracking-tight">
                {formatDuration(totals.worked)}
                <span className="ms-2 font-sans text-base text-muted-foreground">studied</span>
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              {isLoading
                ? " "
                : totals.count === 0
                  ? "Add a task and its effort will build up here."
                  : totals.openCount === 0
                    ? "Every task is finished, so nothing is still estimated."
                    : `${formatDuration(totals.remaining)} still estimated across ${totals.openCount} ${totals.openCount === 1 ? "task" : "tasks"}.`}
            </p>
            <EffortBar
              worked={isLoading ? 0 : totals.worked}
              remaining={isLoading ? 0 : totals.remaining}
              label="Effort put in across all tasks"
              size="md"
              className="mt-4"
            />
            <p className="mt-2 text-xs tabular-nums text-muted-foreground">
              {isLoading ? " " : `${totals.percent}% of the estimated effort. This measures time, not how much of the coursework is finished.`}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-8 gap-y-1 border-t pt-4 @3xl/dashboard:border-t-0 @3xl/dashboard:border-s @3xl/dashboard:ps-8 @3xl/dashboard:pt-0">
            <HeroStat label="Sessions done" value={isLoading ? null : String(totals.sessionsDone)} />
            <HeroStat label="Sessions to come" value={isLoading ? null : String(totals.sessionsUpcoming)} />
          </dl>
        </CardContent>
      </Card>

      {!isLoading && accuracy && <EstimateAccuracyCard accuracy={accuracy} />}

      <div className="grid min-w-0 gap-6 @3xl/dashboard:grid-cols-2">
        {/* ── Outcomes as one proportional bar, not a donut ── */}
        <SectionCard
          title="How sessions went"
          description="Every outcome you have recorded."
          className="rise-in"
        >
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Record what happened after a session and the mix will show here.
            </p>
          ) : (
            <OutcomeMix counts={outcomes} total={history.length} />
          )}
        </SectionCard>

        <SectionCard
          title="Where your time went"
          description="Time studied by kind of work."
          className="rise-in"
        >
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing studied yet. Your first recorded session starts this off.
            </p>
          ) : (
            <ul className="grid gap-3" aria-label="Time studied by category">
              {byCategory.map(({ category, minutes }) => (
                <li key={category} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", CATEGORY_CONFIG[category].dot)} />
                    <span className="truncate">{CATEGORY_CONFIG[category].label}</span>
                  </span>
                  <span aria-hidden className="h-2 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full transition-[width] duration-500 ease-fluid", CATEGORY_CONFIG[category].dot)}
                      style={{ width: `${(minutes / byCategory[0].minutes) * 100}%` }}
                    />
                  </span>
                  <span className="text-end text-xs tabular-nums text-muted-foreground">
                    {formatDuration(minutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="By task"
        description="Time studied compared with your estimate. This measures effort, not how much of the coursework is finished."
        action={
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/tasks" />}>
            All tasks
          </Button>
        }
        flush
      >
        {isLoading ? (
          <div className="space-y-2 p-(--card-spacing)">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ListTodo} title="No tasks yet" className="m-(--card-spacing) border-0" action={<Button nativeButton={false} render={<Link href="/tasks" />}>Add your first task</Button>}>
            Add your first task and its effort will show up here.
          </EmptyState>
        ) : (
          <>
            {/* Column headings only exist once the grid does; below `lg` each
                row labels its own figures instead. */}
            <div className="hidden grid-cols-[minmax(0,1fr)_9rem_5rem_5rem_5rem_7rem] gap-4 border-b bg-muted/35 px-(--card-spacing) py-2.5 @5xl/dashboard:grid">
              <span className="eyebrow">Task</span>
              <span className="eyebrow">Effort</span>
              <span className="eyebrow text-end">Worked</span>
              <span className="eyebrow text-end">Left</span>
              <span className="eyebrow text-end">Sessions</span>
              <span className="eyebrow">Status</span>
            </div>
            <ul className="divide-y">
              {rows.map((row) => (
                <ProgressRow
                  key={row.taskId}
                  row={row}
                  category={taskById.get(row.taskId)?.category ?? "Other"}
                  course={taskById.get(row.taskId)?.course ?? null}
                />
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      {/* ── Completed-session history (SPEC §17.6) ─────────── */}
      <SectionCard
        title="Session history"
        description="Every study session you have recorded, newest first."
        action={
          isLoading ? undefined : (
            <span className="text-xs text-muted-foreground">{history.length} recorded</span>
          )
        }
        flush
      >
        {isLoading ? (
          <div className="space-y-2 p-(--card-spacing)">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : history.length === 0 ? (
          <EmptyState icon={Clock} title="Nothing recorded yet" className="m-(--card-spacing) border-0" action={<Button variant="outline" nativeButton={false} render={<Link href="/calendar" />}>View study sessions</Button>}>
            Once you finish a study session and say how it went, it will be listed here.
          </EmptyState>
        ) : (
          historyByDay.map((group) => {
            const day = inTimeZone(group.date, timeZone);
            const label = `${DAY_NAMES_SHORT[day.getDay()]} ${day.getDate()} ${formatDate(group.date, timeZone, { month: "short" })}`;
            return (
              <section key={group.key} aria-label={label}>
                <h3 className="flex items-center justify-between gap-2 border-b bg-muted/35 px-(--card-spacing) py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <span>{label}</span>
                  <span className="font-medium normal-case tracking-normal tabular-nums">
                    {formatDuration(group.minutes)} studied
                  </span>
                </h3>
                <ul className="divide-y border-b last:border-b-0">
                  {group.sessions.map((session) => (
                    <HistoryRow key={session.id} session={session} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </SectionCard>
    </PageShell>
  );
}

/** How close adjusted estimates have come, as one calm aggregate summary. */
function EstimateAccuracyCard({ accuracy }: { accuracy: EstimationAccuracy }) {
  const percent = accuracy.improvementPercent === null ? null : Math.round(accuracy.improvementPercent);
  const headline =
    percent === null
      ? "How close your estimates have been"
      : percent > 0
        ? `Your adjusted estimates are ${percent}% closer to your real time`
        : percent === 0
          ? "Your adjusted estimates are about as close as your own guesses"
          : "Your first guesses are still closer to your real time";
  const tasks = `${accuracy.sampleSize} ${accuracy.sampleSize === 1 ? "task" : "tasks"}`;

  return (
    <Card className="rise-in min-w-0" size="sm">
      <CardContent className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">{headline}</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            across {tasks} · average miss {formatDuration(accuracy.originalMeanAbsoluteError)} →{" "}
            {formatDuration(accuracy.adaptiveMeanAbsoluteError)}
          </p>
          {!accuracy.adaptiveQualified && (
            <p className="mt-1 text-xs text-muted-foreground">
              StudyFlow keeps using your own guesses for now. Adjusted estimates switch on once they
              beat them.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HeroStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl leading-none tabular-nums font-semibold tracking-tight">
        {value === null ? <Skeleton className="h-6 w-10" /> : value}
      </dd>
    </div>
  );
}

/** Finished, partly done and missed as shares of one bar, with counts below. */
function OutcomeMix({ counts, total }: { counts: Record<Outcome, number>; total: number }) {
  const order: Outcome[] = ["Completed", "Delayed", "Missed"];
  const kept = Math.round((counts.Completed / total) * 100);
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        <span className="text-2xl tabular-nums font-semibold tracking-tight">{kept}%</span>{" "}
        <span className="text-muted-foreground">finished as planned</span>
      </p>
      <div
        role="img"
        aria-label={order.map((outcome) => `${OUTCOME_STYLE[outcome].label}: ${counts[outcome]}`).join(", ")}
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {order.map((outcome) =>
          counts[outcome] > 0 ? (
            <span
              key={outcome}
              className={cn("h-full first:rounded-s-full last:rounded-e-full", OUTCOME_STYLE[outcome].bar)}
              style={{ width: `${(counts[outcome] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul aria-hidden className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {order.map((outcome) => (
          <li key={outcome} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", OUTCOME_STYLE[outcome].bar)} />
            {OUTCOME_STYLE[outcome].label}
            <span className="font-medium tabular-nums text-foreground">{counts[outcome]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProgressRow({
  row,
  category,
  course,
}: {
  row: EffortProgress;
  category: Category;
  course: string | null;
}) {
  return (
    <li className="grid grid-cols-1 gap-2 px-(--card-spacing) py-4 transition-colors duration-150 hover-fine:bg-muted/30 compact:py-2.5 @5xl/dashboard:grid-cols-[minmax(0,1fr)_9rem_5rem_5rem_5rem_7rem] @5xl/dashboard:items-center @5xl/dashboard:gap-4">
      <div className="min-w-0">
        <Link
          href={`/tasks/${row.taskId}`}
          className="block truncate text-sm font-medium underline-offset-4 hover:underline"
        >
          {row.taskTitle}
        </Link>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <CategoryTag category={category} />
          {course && <span className="truncate">{course}</span>}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <EffortBar
          worked={row.actualDuration}
          remaining={row.estimatedRemaining}
          label={`Effort put in on ${row.taskTitle}`}
          className="max-w-32 @5xl/dashboard:max-w-none"
        />
        <span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
          {row.effortPercent}%
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs @5xl/dashboard:contents">
        <span className="text-muted-foreground @5xl/dashboard:text-end">
          <span className="@5xl/dashboard:hidden">Worked: </span>
          <span className="tabular-nums text-foreground">{formatDuration(row.actualDuration)}</span>
        </span>
        <span className="text-muted-foreground @5xl/dashboard:text-end">
          <span className="@5xl/dashboard:hidden">Left: </span>
          <span className="tabular-nums">{formatDuration(row.estimatedRemaining)}</span>
        </span>
        <span className="text-muted-foreground @5xl/dashboard:text-end">
          <span className="@5xl/dashboard:hidden">Sessions: </span>
          <span className="tabular-nums">
            {row.sessionsCompleted}
            {row.sessionsUpcoming > 0 && (
              <span className="text-muted-foreground"> +{row.sessionsUpcoming}</span>
            )}
          </span>
        </span>
        <StatusDot status={row.status} />
      </div>
    </li>
  );
}

function HistoryRow({ session }: { session: StudySession }) {
  const timeZone = useAccountTimezone();
  const style = OUTCOME_STYLE[session.outcome!];

  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-(--card-spacing) py-3 compact:py-2 @3xl/dashboard:grid-cols-[3.25rem_minmax(0,1fr)_7rem_4rem]">
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatClock(session.startTime, timeZone)}
      </span>
      <Link
        href={`/tasks/${session.taskId}`}
        className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
      >
        {session.taskTitle}
      </Link>
      <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", style.tone)}>
        <style.icon className="size-3.5" aria-hidden />
        {style.label}
      </span>
      <span className="col-start-2 text-xs tabular-nums text-muted-foreground @3xl/dashboard:col-start-auto @3xl/dashboard:text-end">
        {formatDuration(session.actualDuration ?? 0)}
      </span>
    </li>
  );
}
