"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarOff,
  Clock3,
  ListTodo,
  Lock,
  TrendingUp,
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

  // Study time still free between now and midnight.
  const todayRemaining = useMemo(() => {
    const now = new Date();
    const endOfDay = new Date(startOfDay(now).getTime() + 24 * 60 * 60_000);
    return availableMinutes(allWindows, allPeriods, now, endOfDay);
  }, [allWindows, allPeriods]);

  // Until a schedule exists, every open minute is Unscheduled Work by
  // definition (SPEC §5.4) — not an empty state, a true one.
  const unscheduledMinutes = useMemo(
    () => feasibility.reduce((sum, f) => sum + f.requiredMinutes, 0),
    [feasibility],
  );

  const firstName = account?.name.trim().split(/\s+/)[0] ?? "";

  function handleCreated(task: AcademicTask) {
    tasks.setData([task, ...allTasks]);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      {/* ── Heading ─────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{firstName ? `${firstName}'s workload` : "Your workload"}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
            What needs attention now?
          </h1>
        </div>

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

      {/* ── Glanceable figures ──────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Today's study time left"
          value={isLoading ? null : formatDuration(todayRemaining)}
          hint={hasWindows ? "free before midnight" : "no availability set"}
          icon={Clock3}
        />
        <Stat
          label="Due in next 7 days"
          value={isLoading ? null : String(verdict.tasks.length)}
          hint="open tasks"
          icon={CalendarDays}
        />
        <Stat
          label="Overloaded"
          value={isLoading ? null : String(overloaded.length)}
          hint={overloaded.length > 0 ? "cannot fit before deadline" : "everything fits"}
          icon={AlertTriangle}
          tone={overloaded.length > 0 ? "deficit" : "surplus"}
        />
        <Stat
          label="Unscheduled work"
          value={isLoading ? null : formatDuration(unscheduledMinutes)}
          hint="no schedule generated yet"
          icon={ListTodo}
        />
      </div>

      {/* ── Capacity verdict ────────────────────── */}
      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : !hasWindows ? (
            <EmptyCapacity />
          ) : (
            <div className="space-y-5">
              <Verdict balance={verdict.balance} count={verdict.tasks.length} days={horizon} />
              <CapacityBar available={verdict.available} committed={verdict.committed} />
              <p className="font-mono text-xs text-muted-foreground">
                Weekly pattern {formatDuration(weeklyPatternMinutes(allWindows))}, read in{" "}
                {preferences.data?.timezone ?? "your timezone"}.{" "}
                <Link
                  href="/availability"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Adjust availability
                </Link>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Quick Add Task (SPEC §17.2) ─────────── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="font-display text-base">Quick add</CardTitle>
          <CardDescription>
            Capture a deadline now; add course, priority and notes later on{" "}
            <Link href="/tasks" className="underline underline-offset-2 hover:text-foreground">
              Tasks
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuickAddTask onCreated={handleCreated} />
        </CardContent>
      </Card>

      {/* ── Deadlines + overload ────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="font-display text-base">Upcoming deadlines</CardTitle>
                <CardDescription>Open work due in the next {horizon} days</CardDescription>
              </div>
              <Link
                href="/tasks"
                className="shrink-0 font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                All tasks →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-6 pt-0">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : verdict.tasks.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                Nothing due in this window. Widen the range, or add a task above.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {verdict.tasks.slice(0, 6).map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={cn(overloaded.length > 0 && "border-deficit/40")}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-display text-base">
              <AlertTriangle
                className={cn(
                  "h-4 w-4",
                  overloaded.length > 0 ? "text-deficit" : "text-muted-foreground",
                )}
              />
              Overload warnings
            </CardTitle>
            <CardDescription>
              Work that cannot fit before its own deadline
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !hasWindows ? (
              <p className="text-sm text-muted-foreground">
                Set your availability to detect overload.
              </p>
            ) : overloaded.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is overloaded. Every open task fits before its deadline.
              </p>
            ) : (
              overloaded.slice(0, 3).map((item) => <OverloadCard key={item.task.id} item={item} />)
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Blocked on the scheduling engine ────── */}
      <Card className="border-dashed bg-muted/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Waiting on the scheduling engine
          </CardTitle>
          <CardDescription>
            These three panels are specified in §17.2 but every figure in them comes
            from Study Sessions, which the API does not expose yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Pending
            icon={Clock3}
            title="Next session"
            detail="Needs generated sessions from CP-SAT."
          />
          <Pending
            icon={ListTodo}
            title="Awaiting outcomes"
            detail="Needs past sessions to record Completed, Delayed or Missed against."
          />
          <Pending
            icon={TrendingUp}
            title="Weekly effort progress"
            detail="Needs Actual Duration, which only session outcomes produce."
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** One glanceable figure. */
function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | null;
  hint: string;
  icon: React.ElementType;
  tone?: "surplus" | "deficit";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="eyebrow leading-tight">{label}</p>
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </div>
        {value === null ? (
          <Skeleton className="mt-2 h-7 w-20" />
        ) : (
          <p
            className={cn(
              "mt-1.5 font-display text-2xl font-semibold tabular-nums",
              tone === "deficit" && "text-deficit",
              tone === "surplus" && "text-surplus",
            )}
          >
            {value}
          </p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
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

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-muted-foreground">Deadline</dt>
        <dd className="text-right">
          {item.deadline.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
        </dd>

        <dt className="text-muted-foreground">Required</dt>
        <dd className="text-right">{formatDuration(item.requiredMinutes)}</dd>

        <dt className="text-muted-foreground">Available</dt>
        <dd className="text-right">{formatDuration(item.availableMinutes)}</dd>

        <dt className="font-medium text-deficit">Shortfall</dt>
        <dd className="text-right font-medium text-deficit">
          {formatDuration(item.shortfallMinutes)}
        </dd>
      </dl>

      {item.relevantPeriods.length > 0 && (
        <>
          <Separator className="my-2 bg-deficit/20" />
          <p className="text-xs text-muted-foreground">
            <CalendarOff className="mr-1 inline h-3 w-3" />
            Blocked by {item.relevantPeriods.map((p) => p.title).join(", ")}
          </p>
        </>
      )}

      {/* §10.5: remedies are the student's to choose; StudyFlow never applies
          them automatically. */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Link
          href={`/tasks/${item.task.id}`}
          className="rounded border border-deficit/30 bg-card px-2 py-1 text-xs transition-colors hover:bg-muted"
        >
          Extend deadline
        </Link>
        <Link
          href="/availability"
          className="rounded border border-deficit/30 bg-card px-2 py-1 text-xs transition-colors hover:bg-muted"
        >
          Add availability
        </Link>
      </div>
    </div>
  );
}

function Pending({
  icon: Icon,
  title,
  detail,
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-dashed bg-card/60 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground/80">{detail}</p>
    </div>
  );
}

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
        <p className="font-display text-3xl font-bold tracking-tight">Nothing due</p>
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
          "font-display text-3xl font-bold tracking-tight",
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
          <Badge
            className={cn(
              "hidden shrink-0 rounded-md border-0 text-xs sm:inline-flex",
              priority.bg,
              priority.color,
            )}
          >
            {priority.label}
          </Badge>
        )}

        <span className="shrink-0 font-mono text-xs text-muted-foreground">
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
