"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarOff,
  Clock3,
  ListChecks,
  Plus,
  ChartLine,
} from "lucide-react";
import { CapacityBar } from "@/components/capacity-bar";
import { QuickAddTask } from "@/components/quick-add-task";
import { formatDuration, CATEGORY_CONFIG, PRIORITY_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  analyseFeasibility,
  assessCapacity,
  availableMinutes,
  startOfDay,
  weeklyPatternMinutes,
} from "@/lib/capacity";
import type { TaskFeasibility } from "@/lib/capacity";
import { account as accountApi, availability as availabilityApi, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";
import type { AcademicTask } from "@/types/task";

const HORIZONS = [
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
];

function deadlineLabel(deadline: string): { text: string; overdue: boolean; urgent: boolean } {
  const diff = new Date(deadline).getTime() - Date.now();
  const hours = Math.round(diff / 3_600_000);
  if (hours < 0)
    return { text: `${Math.abs(Math.round(hours / 24))}d overdue`, overdue: true, urgent: true };
  if (hours < 24) return { text: `in ${hours}h`, overdue: false, urgent: true };
  const days = Math.round(hours / 24);
  return { text: `in ${days}d`, overdue: false, urgent: days <= 2 };
}

export default function DashboardPage() {
  const { account } = useSession();
  const [horizon, setHorizon] = useState(7);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

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

  // SPEC §10.5: an Overload explanation is per task, not one global figure.
  const feasibility = useMemo(
    () => analyseFeasibility(allTasks, allWindows, allPeriods),
    [allTasks, allWindows, allPeriods],
  );
  const overloaded = useMemo(() => feasibility.filter((f) => f.isOverloaded), [feasibility]);

  const todayRemaining = useMemo(() => {
    const now = new Date();
    const endOfDay = new Date(startOfDay(now).getTime() + 24 * 60 * 60_000);
    return availableMinutes(allWindows, allPeriods, now, endOfDay);
  }, [allWindows, allPeriods]);

  // Until a schedule exists, every open minute is Unscheduled Work by the
  // definition in SPEC §5.4 — a true statement, not an empty state.
  const unscheduledMinutes = useMemo(
    () => feasibility.reduce((sum, f) => sum + f.requiredMinutes, 0),
    [feasibility],
  );

  const firstName = account?.name.trim().split(/\s+/)[0] ?? "";

  function handleCreated(task: AcademicTask) {
    tasks.setData([task, ...allTasks]);
    setQuickAddOpen(false);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-8">
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {firstName ? `Hello, ${firstName}` : "Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Whether your coursework fits the time you have.
          </p>
        </div>
        <Button
          className="rounded-full px-4"
          onClick={() => setQuickAddOpen(true)}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add task
        </Button>
      </div>

      {/* ── Verdict: the one loud thing on the page ─────────── */}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow">Capacity</p>
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
            {HORIZONS.map((option) => (
              <button
                key={option.days}
                onClick={() => setHorizon(option.days)}
                aria-pressed={horizon === option.days}
                className={cn(
                  "rounded-[0.3rem] px-2.5 py-1 font-mono text-xs transition-colors",
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

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-14 w-80" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : !hasWindows ? (
          <EmptyCapacity />
        ) : (
          <>
            <Verdict balance={verdict.balance} count={verdict.tasks.length} days={horizon} />
            <CapacityBar available={verdict.available} committed={verdict.committed} />

            <p className="border-t pt-3 font-mono text-xs text-muted-foreground">
              Read in {preferences.data?.timezone ?? "your timezone"}.{" "}
              <Link
                href="/availability"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Adjust availability
              </Link>
            </p>
          </>
        )}
      </section>

      {/* ── Glanceable figures ──────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Clock3}
          value={isLoading ? null : formatDuration(todayRemaining)}
          label="Free today"
        />
        <Stat
          icon={CalendarDays}
          value={isLoading ? null : formatDuration(weeklyPatternMinutes(allWindows))}
          label="Weekly study time"
        />
        <Stat
          icon={ListChecks}
          value={isLoading ? null : formatDuration(unscheduledMinutes)}
          label="Open work"
        />
        <Stat
          icon={AlertTriangle}
          value={isLoading ? null : String(overloaded.length)}
          label="Overloaded tasks"
          tone={overloaded.length > 0 ? "deficit" : undefined}
        />
      </div>

      {/* ── Quick add: opened from the header action (SPEC §17.2) ── */}
      {quickAddOpen && (
        <section>
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="eyebrow">Quick add</p>
                <button
                  onClick={() => setQuickAddOpen(false)}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <QuickAddTask onCreated={handleCreated} />
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Working area ────────────────────────────────────── */}
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <SectionHead
            title="Upcoming deadlines"
            meta={`next ${horizon} days`}
            action={{ href: "/tasks", label: "All tasks" }}
          />
          {isLoading ? (
            <div className="space-y-2 pt-3">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : verdict.tasks.length === 0 ? (
            <p className="pt-4 text-sm text-muted-foreground">
              Nothing due in this window. Widen the range, or add a task.
            </p>
          ) : (
            <ul className="divide-y">
              {verdict.tasks.slice(0, 7).map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHead
            title="Overload warnings"
            meta={
              !hasWindows
                ? "needs availability"
                : overloaded.length === 0
                  ? "none"
                  : `${overloaded.length} affected`
            }
            tone={overloaded.length > 0 ? "deficit" : undefined}
          />
          <div className="space-y-3 pt-3">
            {isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : !hasWindows ? (
              <p className="text-sm text-muted-foreground">
                Set your availability to detect overload.
              </p>
            ) : overloaded.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every open task fits before its deadline.
              </p>
            ) : (
              overloaded.slice(0, 3).map((item) => <OverloadCard key={item.task.id} item={item} />)
            )}
          </div>
        </section>
      </div>

      {/* ── Blocked on the scheduling engine ─────────────────── */}
      <section className="border-t pt-5">
        <p className="eyebrow">Waiting on the scheduling engine</p>
        <p className="mt-1.5 max-w-2xl text-xs text-muted-foreground">
          Next session, awaiting outcomes and weekly effort progress are specified in
          §17.2, but every figure in them derives from Study Sessions, which the API
          does not expose yet.
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground/70">
          <li className="flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" /> Next session
          </li>
          <li className="flex items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5" /> Awaiting outcomes
          </li>
          <li className="flex items-center gap-1.5">
            <ChartLine className="h-3.5 w-3.5" /> Weekly effort progress
          </li>
        </ul>
      </section>
    </div>
  );
}

function SectionHead({
  title,
  meta,
  action,
  tone,
}: {
  title: string;
  meta: string;
  action?: { href: string; label: string };
  tone?: "deficit";
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2">
      <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
      <div className="flex items-baseline gap-3">
        <span className={cn("font-mono text-xs text-muted-foreground", tone === "deficit" && "text-deficit")}>
          {meta}
        </span>
        {action && (
          <Link
            href={action.href}
            className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {action.label} →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * A figure with a soft icon badge. The badge is deliberately neutral: teal and
 * orange are reserved for capacity, so a coloured badge here would dilute the
 * only two colours in the product that carry meaning.
 */
function Stat({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: React.ElementType;
  value: string | null;
  label: string;
  tone?: "deficit";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-full",
          tone === "deficit" ? "bg-deficit-soft text-deficit" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      {value === null ? (
        <Skeleton className="mt-3 h-7 w-20" />
      ) : (
        <p
          className={cn(
            "mt-3 font-display text-2xl font-bold tabular-nums",
            tone === "deficit" && "text-deficit",
          )}
        >
          {value}
        </p>
      )}
      <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** Every field SPEC §10.5 requires of an Overload explanation. */
function OverloadCard({ item }: { item: TaskFeasibility }) {
  return (
    <div className="rounded-md border border-deficit/30 bg-deficit-soft p-3">
      <Link
        href={`/tasks/${item.task.id}`}
        className="block truncate text-sm font-medium underline-offset-4 hover:underline"
      >
        {item.task.title}
      </Link>

      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-muted-foreground">Deadline</dt>
        <dd>{item.deadline.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</dd>

        <dt className="text-muted-foreground">Required</dt>
        <dd>{formatDuration(item.requiredMinutes)}</dd>

        <dt className="text-muted-foreground">Available</dt>
        <dd>{formatDuration(item.availableMinutes)}</dd>

        <dt className="font-medium text-deficit">Shortfall</dt>
        <dd className="font-medium text-deficit">{formatDuration(item.shortfallMinutes)}</dd>
      </dl>

      {item.relevantPeriods.length > 0 && (
        <p className="mt-2 border-t border-deficit/20 pt-2 text-xs text-muted-foreground">
          <CalendarOff className="mr-1 inline h-3 w-3" />
          Blocked by {item.relevantPeriods.map((p) => p.title).join(", ")}
        </p>
      )}

      {/* §10.5: remedies are the student's to choose; StudyFlow never applies
          them automatically. */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Link
          href={`/tasks/${item.task.id}`}
          className="rounded border bg-card px-2 py-1 text-xs transition-colors hover:bg-muted"
        >
          Extend deadline
        </Link>
        <Link
          href="/availability"
          className="rounded border bg-card px-2 py-1 text-xs transition-colors hover:bg-muted"
        >
          Add availability
        </Link>
      </div>
    </div>
  );
}

function Verdict({ balance, count, days }: { balance: number; count: number; days: number }) {
  if (count === 0) {
    return (
      <div>
        <p className="font-display text-5xl font-bold tracking-tighter">Nothing due</p>
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
          "font-display text-5xl font-bold tracking-tighter",
          over ? "text-deficit" : "text-surplus",
        )}
      >
        {over ? `${formatDuration(-balance)} short` : `${formatDuration(balance)} spare`}
      </p>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        {over
          ? `${count} ${count === 1 ? "task does" : "tasks do"} not fit in the study time you have over the next ${days} days.`
          : `${count} ${count === 1 ? "task fits" : "tasks fit"} in the next ${days} days with room left over.`}
      </p>
    </div>
  );
}

function EmptyCapacity() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-md border border-dashed p-6">
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
        className="flex flex-col gap-1 py-2.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.title}</p>
          {/* Priority lives on the meta line so the numeric columns to the
              right stay aligned whether or not a badge is present. */}
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {task.priority === "High" && (
              <Badge className={cn("rounded border-0 px-1 py-0 text-[10px]", priority.bg, priority.color)}>
                High
              </Badge>
            )}
            <span className="truncate">
              {category.label}
              {task.course ? ` · ${task.course}` : ""}
            </span>
          </p>
        </div>

        <span className="flex shrink-0 items-center gap-3 font-mono text-xs sm:contents">
          <span className="text-muted-foreground sm:w-16 sm:text-right">
            {formatDuration(task.remainingDuration)}
          </span>

          <span
            className={cn(
              "flex items-center gap-1 sm:w-24 sm:justify-end",
              due.urgent ? "text-deficit" : "text-muted-foreground",
            )}
          >
            {/* An icon carries the warning too, so urgency is never colour alone. */}
            {due.overdue && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
            {due.text}
          </span>
        </span>
      </Link>
    </li>
  );
}
