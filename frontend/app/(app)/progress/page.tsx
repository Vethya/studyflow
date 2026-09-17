"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, CATEGORY_CONFIG, STATUS_CONFIG, DAY_NAMES_SHORT } from "@/lib/constants";
import { formatClock } from "@/lib/datetime";
import { scheduling, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import {
  EmptyState,
  Figure,
  FigureRow,
  PageHeader,
  PageShell,
  SectionCard,
} from "@/components/page-kit";
import type { EffortProgress } from "@/types/progress";
import type { StudySession } from "@/types/session";
import { activeScheduleKey, effortProgressKey, SWR_KEYS } from "@/lib/swr-keys";

/**
 * Effort progress = time worked ÷ (time worked + estimated time remaining).
 *
 * SPEC §13 is emphatic that this measures expected *effort consumed*, not
 * content completion, quality or grade, so the page says that in the student's
 * own words rather than in the spec's.
 */
export default function ProgressPage() {
  const loadTasks = useCallback((s: AbortSignal) => tasksApi.listTasks({}, s), []);
  const tasks = useApi(SWR_KEYS.tasks, loadTasks);
  const loadSchedule = useCallback(
    (s: AbortSignal) => scheduling.getActiveSchedule(s, tasks.data ?? []),
    [tasks.data],
  );
  const schedule = useApi(
    activeScheduleKey(tasks.data),
    loadSchedule,
  );
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
  const sessions = useMemo(() => schedule.data?.sessions ?? [], [schedule.data]);

  /** Finished sessions, newest first (SPEC §17.6 completed-session history). */
  const history = useMemo(
    () =>
      sessions
        .filter((session) => session.outcome !== undefined)
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [sessions],
  );

  const totals = useMemo(() => {
    const worked = rows.reduce((sum, row) => sum + row.actualDuration, 0);
    const remaining = rows.reduce((sum, row) => sum + row.estimatedRemaining, 0);
    return {
      count: rows.length,
      worked,
      remaining,
      percent: worked + remaining > 0 ? Math.round((worked / (worked + remaining)) * 100) : 0,
      sessionsDone: rows.reduce((sum, row) => sum + row.sessionsCompleted, 0),
      sessionsUpcoming: rows.reduce((sum, row) => sum + row.sessionsUpcoming, 0),
    };
  }, [rows]);

  function reloadAll() {
    tasks.reload();
    effort.reload();
    schedule.reload();
  }

  return (
    <PageShell>
      <PageHeader
        title="Progress"
        description="How much of your estimated effort you have worked through so far."
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

      <FigureRow>
        <Figure label="Tasks" value={isLoading ? null : String(totals.count)} />
        <Figure label="Worked" value={isLoading ? null : formatDuration(totals.worked)} />
        <Figure label="Remaining" value={isLoading ? null : formatDuration(totals.remaining)} />
        <Figure label="Sessions done" value={isLoading ? null : String(totals.sessionsDone)} />
        <Figure
          label="Sessions to come"
          value={isLoading ? null : String(totals.sessionsUpcoming)}
        />
      </FigureRow>

      <SectionCard
        title="By task"
        description="Effort is the time you have put in against the time you expect to need. It does not say how much of the work is finished, or how good it is."
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
          <EmptyState title="No tasks yet" className="m-(--card-spacing) border-0">
            Add your first task and its effort will show up here.
          </EmptyState>
        ) : (
          <>
            {/* Column headings only exist once the grid does; below `lg` each
                row labels its own figures instead. */}
            <div className="hidden grid-cols-[minmax(0,1fr)_6rem_5rem_5rem_5rem_7rem] gap-4 border-b px-(--card-spacing) py-2 lg:grid">
              <span className="text-xs font-medium text-muted-foreground">Task</span>
              <span className="text-xs font-medium text-muted-foreground">Effort</span>
              <span className="text-end text-xs font-medium text-muted-foreground">Worked</span>
              <span className="text-end text-xs font-medium text-muted-foreground">Left</span>
              <span className="text-end text-xs font-medium text-muted-foreground">Sessions</span>
              <span className="text-xs font-medium text-muted-foreground">Status</span>
            </div>
            <ul className="divide-y">
              {rows.map((row) => (
                <ProgressRow
                  key={row.taskId}
                  row={row}
                  category={
                    tasks.data?.find((task) => task.id === row.taskId)?.category ?? "Other"
                  }
                  course={tasks.data?.find((task) => task.id === row.taskId)?.course ?? null}
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
          <EmptyState title="Nothing recorded yet" className="m-(--card-spacing) border-0">
            Once you finish a study session and say how it went, it will be listed here.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {history.map((session) => (
              <HistoryRow key={session.id} session={session} />
            ))}
          </ul>
        )}
      </SectionCard>

    </PageShell>
  );
}

function ProgressRow({
  row,
  category,
  course,
}: {
  row: EffortProgress;
  category: keyof typeof CATEGORY_CONFIG;
  course: string | null;
}) {
  const status = STATUS_CONFIG[row.status];
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(timer);
  }, []);

  return (
    <li className="grid grid-cols-1 gap-2 px-(--card-spacing) py-3 lg:grid-cols-[minmax(0,1fr)_6rem_5rem_5rem_5rem_7rem] lg:items-center lg:gap-4">
      <div className="min-w-0">
        <Link
          href={`/tasks/${row.taskId}`}
          className="block truncate text-sm font-medium underline-offset-4 hover:underline"
        >
          {row.taskTitle}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {CATEGORY_CONFIG[category].label}
          {course ? ` · ${course}` : ""}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted lg:max-w-none">
          <div
            className="h-full rounded-full bg-foreground/50 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ width: mounted ? `${row.effortPercent}%` : "0%" }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {row.effortPercent}%
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs lg:contents">
        <span className="text-muted-foreground lg:text-end">
          <span className="lg:hidden">Worked: </span>
          <span className="tabular-nums">{formatDuration(row.actualDuration)}</span>
        </span>
        <span className="text-muted-foreground lg:text-end">
          <span className="lg:hidden">Left: </span>
          <span className="tabular-nums">{formatDuration(row.estimatedRemaining)}</span>
        </span>
        <span className="text-muted-foreground lg:text-end">
          <span className="lg:hidden">Sessions: </span>
          <span className="tabular-nums">
            {row.sessionsCompleted}
            {row.sessionsUpcoming > 0 && (
              <span className="text-muted-foreground"> +{row.sessionsUpcoming}</span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", status.dotColor)} />
          <span className="truncate text-muted-foreground">{status.label}</span>
        </span>
      </div>
    </li>
  );
}

const OUTCOME_STYLE = {
  Completed: { label: "Finished", icon: CheckCircle2, tone: "text-surplus" },
  Delayed: { label: "Partly done", icon: Clock, tone: "text-muted-foreground" },
  Missed: { label: "Missed", icon: XCircle, tone: "text-deficit" },
} as const;

function HistoryRow({ session }: { session: StudySession }) {
  const start = new Date(session.startTime);
  const style = OUTCOME_STYLE[session.outcome!];

  return (
    <li className="flex flex-col gap-1 px-(--card-spacing) py-2.5 sm:grid sm:grid-cols-[9.5rem_minmax(0,1fr)_7rem_5rem] sm:items-center sm:gap-x-4">
      <div className="flex items-baseline justify-between gap-3 sm:contents">
        <Link
          href={`/tasks/${session.taskId}`}
          className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline sm:order-2"
        >
          {session.taskTitle}
        </Link>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:order-4 sm:text-end">
          {formatDuration(session.actualDuration ?? 0)}
        </span>
      </div>

      <div className="flex items-baseline gap-x-3 text-xs text-muted-foreground sm:contents">
        <span className="shrink-0 tabular-nums sm:order-1">
          {DAY_NAMES_SHORT[start.getDay()]} {start.getDate()}{" "}
          {start.toLocaleDateString(undefined, { month: "short" })} · {formatClock(start)}
        </span>
        <span className={cn("flex shrink-0 items-center gap-1.5 sm:order-3", style.tone)}>
          <style.icon className="size-3.5" aria-hidden />
          {style.label}
        </span>
      </div>
    </li>
  );
}
