"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ArrowRight, CalendarOff, Clock3, Plus } from "lucide-react";
import { CapacityBar } from "@/components/capacity-bar";
import { formatDuration, CATEGORY_CONFIG, PRIORITY_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { assessCapacity, weeklyPatternMinutes } from "@/lib/capacity";
import { account as accountApi, availability as availabilityApi, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";
import type { AcademicTask } from "@/types/task";

const HORIZONS = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

function deadlineLabel(deadline: string): { text: string; urgent: boolean } {
  const diff = new Date(deadline).getTime() - Date.now();
  const hours = Math.round(diff / 3_600_000);
  if (hours < 0) return { text: `${Math.abs(Math.round(hours / 24))}d overdue`, urgent: true };
  if (hours < 24) return { text: `in ${hours}h`, urgent: true };
  const days = Math.round(hours / 24);
  return { text: `in ${days}d`, urgent: days <= 2 };
}

export default function DashboardPage() {
  const { account } = useSession();
  const [horizon, setHorizon] = useState(7);

  const loadTasks = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const loadWindows = useCallback(
    (signal: AbortSignal) => availabilityApi.listWindows(signal),
    [],
  );
  const loadPeriods = useCallback(
    (signal: AbortSignal) => availabilityApi.listUnavailablePeriods(signal),
    [],
  );
  const loadPreferences = useCallback(
    (signal: AbortSignal) => accountApi.getPreferences(signal),
    [],
  );

  const tasks = useApi(loadTasks);
  const windows = useApi(loadWindows);
  const periods = useApi(loadPeriods);
  const preferences = useApi(loadPreferences);

  const isLoading =
    tasks.isLoading || windows.isLoading || periods.isLoading || preferences.isLoading;
  const loadError = tasks.error ?? windows.error ?? periods.error ?? preferences.error;

  const verdict = useMemo(
    () => assessCapacity(tasks.data ?? [], windows.data ?? [], periods.data ?? [], horizon),
    [tasks.data, windows.data, periods.data, horizon],
  );

  const hasWindows = (windows.data ?? []).length > 0;
  const overdue = useMemo(
    () => (tasks.data ?? []).filter((task) => task.status === "Overdue"),
    [tasks.data],
  );

  // Committed minutes grouped by course, largest first. Tasks with no course
  // are pooled rather than dropped, so the totals still reconcile.
  const byCourse = useMemo(() => {
    const totals = new Map<string, number>();
    for (const task of verdict.tasks) {
      const key = task.course?.trim() || "No course";
      totals.set(key, (totals.get(key) ?? 0) + task.remainingDuration);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [verdict.tasks]);

  const firstName = account?.name.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6">
      {/* ── Verdict ─────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">
              {firstName ? `${firstName}'s workload` : "Your workload"}
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
              Does it fit?
            </h1>
          </div>

          {/* Horizon switch. Capacity is meaningless without a window of time. */}
          <div className="flex items-center rounded-md border bg-card p-0.5">
            {HORIZONS.map((option) => (
              <button
                key={option.days}
                onClick={() => setHorizon(option.days)}
                className={cn(
                  "rounded-[0.3rem] px-3 py-1.5 font-mono text-xs transition-colors",
                  horizon === option.days
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {loadError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>{describeError(loadError)}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  tasks.reload();
                  windows.reload();
                  periods.reload();
                }}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="p-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-72" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : !hasWindows ? (
              <EmptyCapacity />
            ) : (
              <div className="space-y-5">
                <Verdict
                  balance={verdict.balance}
                  count={verdict.tasks.length}
                  days={horizon}
                />
                <CapacityBar
                  available={verdict.available}
                  committed={verdict.committed}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {hasWindows && !isLoading && (
          <p className="font-mono text-xs text-muted-foreground">
            Your weekly pattern is {formatDuration(weeklyPatternMinutes(windows.data ?? []))},
            read in {preferences.data?.timezone ?? "your timezone"}.{" "}
            <Link href="/availability" className="underline underline-offset-2 hover:text-foreground">
              Adjust availability
            </Link>
          </p>
        )}
      </section>

      {/* ── Attention + distribution ────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="font-display text-base">Next up</CardTitle>
                <CardDescription>
                  Open work due in the next {horizon} days, soonest first
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/tasks" />}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add task
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-6 pt-0">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : verdict.tasks.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                Nothing due in this window. Widen the range or add a task.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {verdict.tasks.slice(0, 8).map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          {overdue.length > 0 && (
            <Card className="border-deficit/40 bg-deficit-soft">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <AlertTriangle className="h-4 w-4 text-deficit" />
                  {overdue.length} overdue
                </CardTitle>
                <CardDescription>
                  Past their deadline and still counted against your time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {overdue.slice(0, 4).map((task) => (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-card"
                  >
                    <span className="truncate">{task.title}</span>
                    <span className="shrink-0 font-mono text-xs text-deficit">
                      {formatDuration(task.remainingDuration)}
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base">Where the time goes</CardTitle>
              <CardDescription>Committed minutes by course</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <>
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </>
              ) : byCourse.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No open work in this window.
                </p>
              ) : (
                byCourse.map(([course, minutes]) => {
                  const share = verdict.committed > 0 ? minutes / verdict.committed : 0;
                  return (
                    <div key={course} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate">{course}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {formatDuration(minutes)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground/70"
                          style={{ width: `${Math.round(share * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The headline sentence. Plain language, no hedging, no exclamation. */
function Verdict({
  balance,
  count,
  days,
}: {
  balance: number;
  count: number;
  days: number;
}) {
  if (count === 0) {
    return (
      <div>
        <p className="font-display text-4xl font-bold tracking-tight">Nothing due</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
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
          "font-display text-4xl font-bold tracking-tight",
          over ? "text-deficit" : "text-surplus",
        )}
      >
        {over ? `${formatDuration(-balance)} short` : `${formatDuration(balance)} spare`}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {over
          ? `${count} ${count === 1 ? "task does" : "tasks do"} not fit in the study time you have over the next ${days} days.`
          : `${count} ${count === 1 ? "task fits" : "tasks fit"} in the next ${days} days with room left over.`}
      </p>
    </div>
  );
}

/** Shown when availability has never been set, which makes capacity unknowable. */
function EmptyCapacity() {
  return (
    <div className="flex flex-col items-start gap-4 py-2">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted">
        <CalendarOff className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="font-display text-xl font-semibold">No study time set</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          StudyFlow weighs your coursework against the hours you are actually free.
          Add your weekly availability and this becomes a real answer.
        </p>
      </div>
      <Button size="sm" nativeButton={false} render={<Link href="/availability" />}>
        Set availability
        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function TaskRow({ task }: { task: AcademicTask }) {
  const due = deadlineLabel(task.deadline);
  const category = CATEGORY_CONFIG[task.category];
  const priority = PRIORITY_CONFIG[task.priority];

  return (
    <li>
      <Link
        href={`/tasks/${task.id}`}
        className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {category.label}
            {task.course ? ` · ${task.course}` : ""}
          </p>
        </div>

        {task.priority === "High" && (
          <Badge className={cn("hidden shrink-0 rounded-md border-0 text-xs sm:inline-flex", priority.bg, priority.color)}>
            {priority.label}
          </Badge>
        )}

        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          <Clock3 className="mr-1 inline h-3 w-3" />
          {formatDuration(task.remainingDuration)}
        </span>

        <span
          className={cn(
            "w-20 shrink-0 text-right font-mono text-xs",
            due.urgent ? "text-deficit" : "text-muted-foreground",
          )}
        >
          {due.text}
        </span>
      </Link>
    </li>
  );
}
