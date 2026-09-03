"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Calendar as DatePicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DAY_NAMES_SHORT, formatDuration, CATEGORY_CONFIG } from "@/lib/constants";
import { describeDeadline, formatClock } from "@/lib/datetime";
import {
  dayKey,
  expandUnavailablePeriods,
  expandWindows,
  startOfDay,
  subtractPeriods,
  totalMinutes,
} from "@/lib/capacity";
import {
  ScheduleTechnicalFailure,
  availability as availabilityApi,
  scheduling,
  tasks as tasksApi,
} from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useIsMobile } from "@/hooks/use-mobile";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { PageHeader, PageShell, SectionHeader, StatTile } from "@/components/page-kit";
import { GridLegend, WeekGrid, type GridBlock, type GridColumn } from "@/components/week-grid";
import { SessionDrawer } from "@/components/session-drawer";
import { RecordOutcomeDialog } from "@/components/record-outcome-dialog";
import { PendingPlanBanner, SchedulePreview } from "@/components/schedule-preview";
import { UnscheduledWorkList } from "@/components/unscheduled-work-list";
import type { AcademicTask } from "@/types/task";
import type { StudySession } from "@/types/session";
import type { ScheduleProposal } from "@/types/schedule";

const DEFAULT_RANGE = { start: 8, end: 22 };

function weekStart(date: Date): Date {
  const day = startOfDay(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const minutesSinceMidnight = (date: Date) => date.getHours() * 60 + date.getMinutes();

export default function CalendarPage() {
  const isMobile = useIsMobile();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AcademicTask | null>(null);

  const [selectedSession, setSelectedSession] = useState<StudySession | null>(null);
  const [outcomeSession, setOutcomeSession] = useState<StudySession | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AcademicTask | null>(null);

  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isGenerating, setGenerating] = useState(false);
  const [technicalFailure, setTechnicalFailure] = useState<string | null>(null);

  const loadTasks = useCallback((s: AbortSignal) => tasksApi.listTasks({}, s), []);
  const loadWindows = useCallback((s: AbortSignal) => availabilityApi.listWindows(s), []);
  const loadPeriods = useCallback((s: AbortSignal) => availabilityApi.listUnavailablePeriods(s), []);
  const loadSchedule = useCallback((s: AbortSignal) => scheduling.getActiveSchedule(s), []);
  const loadRevision = useCallback((s: AbortSignal) => scheduling.getPendingRevision(s), []);

  const tasks = useApi(loadTasks);
  const windows = useApi(loadWindows);
  const periods = useApi(loadPeriods);
  const schedule = useApi(loadSchedule);
  const revision = useApi(loadRevision);

  const isLoading =
    tasks.isLoading || windows.isLoading || periods.isLoading || schedule.isLoading;
  const loadError = tasks.error ?? windows.error ?? periods.error ?? schedule.error;

  const allTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
  const allWindows = useMemo(() => windows.data ?? [], [windows.data]);
  const allPeriods = useMemo(() => periods.data ?? [], [periods.data]);
  const sessions = useMemo(() => schedule.data?.sessions ?? [], [schedule.data]);

  /** A revision waits for review the moment it exists (SPEC §14.1). */
  const pendingPlan = revision.data ?? proposal;

  const days = useMemo(() => {
    if (isMobile) return [startOfDay(anchor)];
    const start = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addCalendarDays(start, i));
  }, [anchor, isMobile]);

  const rangeStart = days[0];
  const rangeEnd = useMemo(
    () => addCalendarDays(days[days.length - 1], 1),
    [days],
  );

  const freeIntervals = useMemo(
    () => subtractPeriods(expandWindows(allWindows, rangeStart, rangeEnd), allPeriods),
    [allWindows, allPeriods, rangeStart, rangeEnd],
  );
  const blockedIntervals = useMemo(
    () => expandUnavailablePeriods(allPeriods, rangeStart, rangeEnd),
    [allPeriods, rangeStart, rangeEnd],
  );

  // Use clipped periods so historical and far-future blocks cannot stretch
  // the visible grid outside the displayed date range.
  const hourRange = useMemo(() => {
    if (allWindows.length === 0 && blockedIntervals.length === 0 && sessions.length === 0) {
      return DEFAULT_RANGE;
    }
    let min = 24;
    let max = 0;
    for (const w of allWindows) {
      const startHour = Number(w.startTime.slice(0, 2));
      const endHour = Number(w.endTime.slice(0, 2));
      min = Math.min(min, startHour);
      max = Math.max(max, w.endTime.slice(3, 5) === "00" ? endHour : endHour + 1);
    }
    for (const session of sessions) {
      min = Math.min(min, new Date(session.startTime).getHours());
      max = Math.max(max, new Date(session.endTime).getHours() + 1);
    }
    for (const interval of blockedIntervals) {
      min = Math.min(min, interval.start.getHours());
      max = Math.max(max, interval.end.getHours() + 1);
    }
    if (min > max) return DEFAULT_RANGE;
    return { start: Math.max(0, min - 1), end: Math.min(24, Math.max(max + 1, min + 6)) };
  }, [allWindows, blockedIntervals, sessions]);
  const columns: GridColumn[] = useMemo(() => {
    const todayKey = dayKey(new Date());
    return days.map((day) => ({
      key: dayKey(day),
      label: DAY_NAMES_SHORT[day.getDay()],
      sublabel: String(day.getDate()),
      isToday: dayKey(day) === todayKey,
    }));
  }, [days]);

  const blocks: GridBlock[] = useMemo(() => {
    const out: GridBlock[] = [];
    const visible = new Set(days.map(dayKey));

    const pushCapacity = (
      intervals: { start: Date; end: Date }[],
      variant: "available" | "blocked",
      prefix: string,
    ) => {
      intervals.forEach((interval, index) => {
        for (const day of days) {
          const dayStart = startOfDay(day);
          const dayEnd = addCalendarDays(dayStart, 1);
          const start = interval.start < dayStart ? dayStart : interval.start;
          const end = interval.end > dayEnd ? dayEnd : interval.end;
          if (end <= start) continue;
          out.push({
            id: `${prefix}-${index}-${dayKey(day)}`,
            columnKey: dayKey(day),
            start: minutesSinceMidnight(start),
            end: minutesSinceMidnight(end) === 0 ? 1440 : minutesSinceMidnight(end),
            variant,
            title: variant === "blocked" ? "Blocked time" : "Free to study",
          });
        }
      });
    };

    pushCapacity(freeIntervals, "available", "free");
    pushCapacity(blockedIntervals, "blocked", "blocked");

    for (const session of sessions) {
      const start = new Date(session.startTime);
      const key = dayKey(start);
      if (!visible.has(key)) continue;
      out.push({
        id: session.id,
        columnKey: key,
        start: minutesSinceMidnight(start),
        end: minutesSinceMidnight(new Date(session.endTime)),
        variant: "session",
        label: session.taskTitle,
        meta: `${formatClock(session.startTime)}–${formatClock(session.endTime)}`,
        title: `${session.taskTitle} · ${formatClock(session.startTime)}–${formatClock(session.endTime)}`,
        settled: Boolean(session.outcome),
        attention: session.isAwaitingOutcome,
        onSelect: () => setSelectedSession(session),
      });
    }

    return out;
  }, [freeIntervals, blockedIntervals, sessions, days]);

  const deadlinesByDay = useMemo(() => {
    const map = new Map<string, AcademicTask[]>();
    for (const task of allTasks) {
      if (task.status === "Completed") continue;
      const key = dayKey(new Date(task.deadline));
      const bucket = map.get(key);
      if (bucket) bucket.push(task);
      else map.set(key, [task]);
    }
    return map;
  }, [allTasks]);

  const agenda = useMemo(() => {
    const from = startOfDay(new Date());
    const to = addCalendarDays(from, 14);
    return allTasks
      .filter((task) => task.status !== "Completed")
      .filter((task) => {
        const due = new Date(task.deadline);
        return due >= from && due < to;
      })
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  }, [allTasks]);

  /** Task groups the sidebar shows (SPEC §17.3). */
  const grouped = useMemo(() => {
    const scheduledTaskIds = new Set(
      sessions.filter((session) => !session.outcome).map((session) => session.taskId),
    );
    const open = allTasks.filter(
      (task) => task.status === "Not Started" || task.status === "In Progress",
    );
    return {
      overdue: allTasks.filter((task) => task.status === "Overdue"),
      // Unscheduled Work is open work with no valid session (SPEC §5.4) —
      // not simply "everything you have left".
      unscheduled: open.filter(
        (task) => task.remainingDuration > 0 && !scheduledTaskIds.has(task.id),
      ),
      active: open.filter((task) => scheduledTaskIds.has(task.id)),
      completed: allTasks.filter((task) => task.status === "Completed"),
    };
  }, [allTasks, sessions]);

  const weekSummary = useMemo(() => {
    const free = totalMinutes(freeIntervals);
    const blocked = totalMinutes(blockedIntervals);
    const visible = new Set(days.map(dayKey));
    const scheduled = sessions
      .filter((session) => visible.has(dayKey(new Date(session.startTime))))
      .reduce((sum, session) => sum + session.plannedDuration, 0);
    const due = days.reduce((sum, day) => sum + (deadlinesByDay.get(dayKey(day))?.length ?? 0), 0);
    return { free, blocked, scheduled, due };
  }, [freeIntervals, blockedIntervals, sessions, days, deadlinesByDay]);

  const now = new Date();
  const nowMarker = days.some((day) => dayKey(day) === dayKey(now))
    ? { columnKey: dayKey(now), minutes: minutesSinceMidnight(now) }
    : undefined;

  const title = isMobile
    ? anchor.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : `${days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  const shift = (direction: number) =>
    setAnchor(addCalendarDays(anchor, direction * (isMobile ? 1 : 7)));

  /** Whether the view is already showing today (mobile) or this week. */
  const isCurrentPeriod = isMobile
    ? dayKey(anchor) === dayKey(now)
    : dayKey(weekStart(anchor)) === dayKey(weekStart(now));

  const selectedTask = selectedSession
    ? (allTasks.find((task) => task.id === selectedSession.taskId) ?? null)
    : null;

  async function generate() {
    setGenerating(true);
    setTechnicalFailure(null);
    try {
      const next = await scheduling.generateProposal();
      setProposal(next);
      setPreviewOpen(true);
    } catch (cause) {
      // SPEC §10.7: a technical failure is never reported as Overload, and
      // never touches the active schedule.
      if (cause instanceof ScheduleTechnicalFailure) setTechnicalFailure(cause.message);
      else toast.error(describeError(cause));
    } finally {
      setGenerating(false);
    }
  }

  function refreshAll() {
    tasks.reload();
    schedule.reload();
    revision.reload();
  }

  return (
    <PageShell>
      <PageHeader
        title={title}
        description="Your sessions and deadlines against the study time each day actually holds."
        actions={
          <>
            {/*
              The middle button used to read "Today" and sat flush against the
              next-week chevron, so a click near its edge landed on the arrow
              and appeared to jump a week forward. It now says which period it
              returns to, is wide enough to hit, and is disabled once you are
              already there — a mis-click can no longer move anything.
            */}
            <div className="flex items-center rounded-lg border bg-card">
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-e-none"
                onClick={() => shift(-1)}
                aria-label={isMobile ? "Previous day" : "Previous week"}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-none border-x px-3.5 disabled:opacity-100 disabled:text-muted-foreground"
                onClick={() => setAnchor(new Date())}
                disabled={isCurrentPeriod}
              >
                {isMobile ? "Today" : "This week"}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-s-none"
                onClick={() => shift(1)}
                aria-label={isMobile ? "Next day" : "Next week"}
              >
                <ChevronRight />
              </Button>
            </div>

            <Popover>
              <PopoverTrigger
                render={
                  <Button variant="outline" size="sm">
                    <CalendarDays />
                    Jump to
                  </Button>
                }
              />
              <PopoverContent className="w-auto p-0" align="end">
                <DatePicker
                  mode="single"
                  selected={anchor}
                  onSelect={(date) => date && setAnchor(date)}
                  autoFocus
                />
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void generate()}
              disabled={isGenerating}
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Plan my time
            </Button>

            <Button
              size="sm"
              onClick={() => {
                setEditingTask(null);
                setDialogOpen(true);
              }}
            >
              <Plus />
              Add task
            </Button>
          </>
        }
      />

      {loadError && (
        <Callout
          tone="danger"
          title="Could not load your calendar"
          actions={
            <Button variant="outline" size="sm" onClick={refreshAll}>
              Try again
            </Button>
          }
        >
          {describeError(loadError)}
        </Callout>
      )}

      {/* SPEC §10.7: clearly labelled, and explicitly not an Overload. */}
      {technicalFailure && (
        <Callout
          tone="danger"
          title="StudyFlow could not work out a plan"
          actions={
            <Button variant="outline" size="sm" onClick={() => void generate()}>
              Try again
            </Button>
          }
        >
          {technicalFailure} This is a problem on our side, not a sign that your work does
          not fit. Your current plan has not changed.
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Clock3}
          value={isLoading ? null : formatDuration(weekSummary.free)}
          label={isMobile ? "Free this day" : "Free this week"}
          tone="surplus"
        />
        <StatTile
          icon={CalendarDays}
          value={isLoading ? null : formatDuration(weekSummary.scheduled)}
          label="Study planned"
        />
        <StatTile
          icon={CalendarDays}
          value={isLoading ? null : formatDuration(weekSummary.blocked)}
          label="Blocked"
          hint="By your exceptions"
        />
        <StatTile
          icon={ListChecks}
          value={isLoading ? null : String(weekSummary.due)}
          label={weekSummary.due === 1 ? "Deadline here" : "Deadlines here"}
          tone={weekSummary.due > 0 ? "deficit" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {isLoading ? (
            <Skeleton className="h-[30rem] w-full rounded-xl" />
          ) : (
            <WeekGrid
              columns={columns}
              blocks={blocks}
              hourStart={hourRange.start}
              hourEnd={hourRange.end}
              now={nowMarker}
              renderLane={(column) => {
                const due = deadlinesByDay.get(column.key) ?? [];
                if (due.length === 0) return null;
                return (
                  <>
                    {due.slice(0, 2).map((task) => (
                      <Link
                        key={task.id}
                        href={`/tasks/${task.id}`}
                        title={`${task.title} — due ${formatClock(task.deadline)}`}
                        className="block rounded-sm bg-deficit-soft px-1.5 py-1 text-start text-[0.6875rem] leading-tight text-deficit transition-colors hover:bg-deficit/20"
                      >
                        <span className="line-clamp-2">{task.title}</span>
                      </Link>
                    ))}
                    {due.length > 2 && (
                      <span className="block px-1.5 text-[0.6875rem] text-muted-foreground">
                        +{due.length - 2} more
                      </span>
                    )}
                  </>
                );
              }}
            />
          )}
          <GridLegend showDeadline showSession />
        </div>

        {/* ── Task sidebar (SPEC §17.3) ─────────────────────── */}
        <aside className="min-w-0 space-y-5">
          <TaskGroup title="Overdue" tasks={grouped.overdue} tone="deficit" />
          <TaskGroup
            title="No slot yet"
            tasks={grouped.unscheduled}
            tone="deficit"
            empty="Everything has a slot."
          />
          <TaskGroup title="Scheduled" tasks={grouped.active} />
          <TaskGroup title="Done" tasks={grouped.completed} muted />
        </aside>
      </div>

      {/* Unscheduled Work, with its explanation and remedies (SPEC §17.3). */}
      {pendingPlan && pendingPlan.unscheduledWork.length > 0 && (
        <section>
          <SectionHeader
            title="Work with no slot"
            meta={`${pendingPlan.unscheduledWork.length} to resolve`}
            tone="deficit"
          />
          <div className="pt-3">
            <UnscheduledWorkList items={pendingPlan.unscheduledWork} />
          </div>
        </section>
      )}

      <section>
        <SectionHeader
          title="Upcoming deadlines"
          meta={`${agenda.length} in the next 14 days`}
          action={{ href: "/tasks", label: "All tasks" }}
        />

        {isLoading ? (
          <div className="space-y-2 pt-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : agenda.length === 0 ? (
          <p className="pt-4 text-sm text-muted-foreground">
            Nothing due in the next two weeks.
          </p>
        ) : (
          <ul className="divide-y">
            {agenda.map((task) => {
              const due = new Date(task.deadline);
              const phrase = describeDeadline(task.deadline);
              return (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex flex-col gap-1 py-2.5 transition-colors hover:bg-muted/40 sm:grid sm:grid-cols-[9.5rem_minmax(0,1fr)_5.5rem_3.5rem_4.5rem] sm:items-center sm:gap-x-4"
                  >
                    <div className="flex items-baseline justify-between gap-3 sm:contents">
                      <span className="min-w-0 truncate text-sm font-medium sm:order-2">
                        {task.title}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs font-medium tabular-nums sm:order-5 sm:text-end",
                          phrase.urgent ? "text-deficit" : "text-muted-foreground",
                        )}
                      >
                        {phrase.short}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-x-3 text-xs text-muted-foreground sm:contents">
                      <span className="shrink-0 tabular-nums sm:order-1">
                        {due.toLocaleDateString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                        {" · "}
                        {formatClock(due)}
                      </span>
                      <span className="truncate sm:order-3">
                        {CATEGORY_CONFIG[task.category].label}
                      </span>
                      <span className="shrink-0 tabular-nums sm:order-4 sm:text-end">
                        {formatDuration(task.remainingDuration)}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SessionDrawer
        session={selectedSession}
        task={selectedTask}
        open={selectedSession !== null}
        onOpenChange={(next) => !next && setSelectedSession(null)}
        onEditTask={() => {
          setEditingTask(selectedTask);
          setSelectedSession(null);
          setDialogOpen(true);
        }}
        onDeleteTask={() => {
          setConfirmDelete(selectedTask);
          setSelectedSession(null);
        }}
        onRecordOutcome={() => {
          setOutcomeSession(selectedSession);
          setSelectedSession(null);
        }}
      />

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
        availabilityWindows={allWindows}
        unavailablePeriods={allPeriods}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onAccepted={() => {
          setProposal(null);
          refreshAll();
        }}
        onRejected={() => {
          setProposal(null);
          revision.reload();
        }}
      />

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        onSaved={(task) => {
          tasks.reload();
          setEditingTask(null);
          toast.success(editingTask ? "Task updated" : "Task added");
          void task;
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(next) => !next && setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.title ?? ""}”?`}
        description="This also removes its study sessions and the record of time you have already put in. It cannot be undone."
        confirmLabel="Delete task"
        destructive
        onConfirm={async () => {
          if (!confirmDelete) return;
          try {
            await tasksApi.deleteTask(confirmDelete.id);
            toast.success("Task deleted");
            refreshAll();
          } catch (cause) {
            toast.error(describeError(cause));
          } finally {
            setConfirmDelete(null);
          }
        }}
      />
    </PageShell>
  );
}

function TaskGroup({
  title,
  tasks,
  tone,
  muted,
  empty = "None",
}: {
  title: string;
  tasks: AcademicTask[];
  tone?: "deficit";
  muted?: boolean;
  empty?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-b pb-1.5">
        <h3
          className={cn(
            "text-xs font-medium",
            tone === "deficit" && tasks.length > 0 ? "text-deficit" : "text-muted-foreground",
          )}
        >
          {title}
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="pt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="pt-1">
          {tasks.slice(0, 6).map((task) => (
            <li key={task.id}>
              <Link
                href={`/tasks/${task.id}`}
                className={cn(
                  "flex items-baseline justify-between gap-2 py-1.5 text-xs transition-colors hover:text-foreground",
                  muted ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                <span className="min-w-0 truncate">{task.title}</span>
                {!muted && (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatDuration(task.remainingDuration)}
                  </span>
                )}
              </Link>
            </li>
          ))}
          {tasks.length > 6 && (
            <li className="pt-1 text-xs text-muted-foreground">+{tasks.length - 6} more</li>
          )}
        </ul>
      )}
    </div>
  );
}
