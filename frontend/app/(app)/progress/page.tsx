"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, CATEGORY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import { tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import type { AcademicTask } from "@/types/task";

/**
 * SPEC §13 / §17.6.
 *
 * Effort Progress = Actual Duration / (Actual Duration + estimated remaining).
 * Actual Duration comes only from Session Outcomes, which the API does not
 * expose, so every task currently reports zero worked minutes and 0% effort.
 * That is shown as a stated limitation rather than hidden, because a blank
 * page would imply there is nothing to measure.
 */
export default function ProgressPage() {
  const load = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const { data, error, isLoading, reload } = useApi(load);

  const tasks = useMemo(() => data ?? [], [data]);

  const totals = useMemo(() => {
    const planned = tasks.reduce((sum, t) => sum + t.plannedDuration, 0);
    const remaining = tasks.reduce((sum, t) => sum + t.remainingDuration, 0);
    const worked = tasks.reduce((sum, t) => sum + t.actualDuration, 0);
    return { planned, remaining, worked, count: tasks.length };
  }, [tasks]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
      <div>
        <p className="eyebrow">Effort</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Progress</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Effort Progress measures the share of expected effort consumed — not content
          completion, quality, or grade.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{describeError(error)}</span>
            <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* The honest caveat, stated once and prominently. */}
      <div className="flex items-start gap-3 rounded-md border border-dashed bg-muted/30 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Actual minutes worked come from Session Outcomes (§12), which the API does not
          record yet. Until it does, every task reports zero worked minutes, so Effort
          Progress reads 0% and session counts are unavailable. Planned and estimated
          remaining minutes below are real.
        </p>
      </div>

      {/* Totals */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y py-4 sm:grid-cols-4">
        <Total label="Tasks" value={isLoading ? null : String(totals.count)} />
        <Total label="Planned" value={isLoading ? null : formatDuration(totals.planned)} />
        <Total label="Est. remaining" value={isLoading ? null : formatDuration(totals.remaining)} />
        <Total label="Worked" value={isLoading ? null : formatDuration(totals.worked)} pending />
      </dl>

      {/* Per-task effort (SPEC §13 display list) */}
      <section>
        <div className="flex items-baseline justify-between gap-3 border-b pb-2">
          <h2 className="font-display text-base font-semibold tracking-tight">By task</h2>
          <Link
            href="/tasks"
            className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            All tasks →
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-2 pt-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <p className="pt-4 text-sm text-muted-foreground">
            No tasks yet. Add one to start tracking effort.
          </p>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_5rem_6rem_6rem_7rem] gap-4 border-b pt-3 pb-1.5 lg:grid">
              <span className="eyebrow">Task</span>
              <span className="eyebrow text-right">Effort</span>
              <span className="eyebrow text-right">Worked</span>
              <span className="eyebrow text-right">Remaining</span>
              <span className="eyebrow">Status</span>
            </div>
            <ul className="divide-y">
              {tasks.map((task) => (
                <ProgressRow key={task.id} task={task} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Total({
  label,
  value,
  pending,
}: {
  label: string;
  value: string | null;
  pending?: boolean;
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      {value === null ? (
        <Skeleton className="mt-1.5 h-7 w-16" />
      ) : (
        <dd
          className={cn(
            "mt-1 font-display text-2xl font-semibold tabular-nums",
            pending && "text-muted-foreground/50",
          )}
        >
          {value}
          {pending && <span className="ml-1.5 font-sans text-[10px] font-normal">pending</span>}
        </dd>
      )}
    </div>
  );
}

function ProgressRow({ task }: { task: AcademicTask }) {
  const status = STATUS_CONFIG[task.status];
  const denominator = task.actualDuration + task.remainingDuration;
  const effort = denominator > 0 ? Math.round((task.actualDuration / denominator) * 100) : 0;

  return (
    <li className="grid grid-cols-1 gap-2 py-3 lg:grid-cols-[minmax(0,1fr)_5rem_6rem_6rem_7rem] lg:items-center lg:gap-4">
      <div className="min-w-0">
        <Link
          href={`/tasks/${task.id}`}
          className="block truncate text-sm font-medium underline-offset-4 hover:underline"
        >
          {task.title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {CATEGORY_CONFIG[task.category].label}
          {task.course ? ` · ${task.course}` : ""}
        </p>
      </div>

      {/* Effort bar plus figure — the bar alone would encode nothing at 0%. */}
      <div className="flex items-center gap-2 lg:block">
        <div className="h-1 w-16 overflow-hidden rounded-full bg-muted lg:mb-1 lg:w-full">
          <div className="h-full rounded-full bg-foreground/60" style={{ width: `${effort}%` }} />
        </div>
        <span className="font-mono text-xs text-muted-foreground lg:block lg:text-right">
          {effort}%
        </span>
      </div>

      <span className="font-mono text-xs text-muted-foreground/50 lg:text-right">
        {formatDuration(task.actualDuration)}
      </span>
      <span className="font-mono text-xs text-muted-foreground lg:text-right">
        {formatDuration(task.remainingDuration)}
      </span>
      <span className="flex items-center gap-1.5 text-xs">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.dotColor)} />
        <span className="truncate text-muted-foreground">{status.label}</span>
      </span>
    </li>
  );
}
