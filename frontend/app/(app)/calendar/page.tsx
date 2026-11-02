"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StudyAgenda } from "@/components/study-agenda";
import { Callout } from "@/components/ui/callout";
import { Calendar as DatePicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Flag,
  Loader2,
  CheckCircle2,
  Plus,
  Sparkles,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { DAY_NAMES_SHORT, formatDuration, CATEGORY_CONFIG } from "@/lib/constants";
import {
  addZonedDays,
  describeDeadline,
  formatClock,
  formatDate,
  inTimeZone,
  minutesSinceMidnight,
  zonedCalendarDate,
} from "@/lib/datetime";
import { applyRecordedOutcome } from "@/lib/outcome-ui";
import { labelSessions } from "@/lib/session-labels";
import {
  dayKey,
  expandUnavailablePeriods,
  expandWindows,
  minutesByDay,
  startOfDay,
  subtractPeriods,
  totalMinutes,
} from "@/lib/capacity";
import {
  applyTaskOverlays,
  flushPendingActions,
  isTaskRemoved,
  scheduleUndoable,
  useTaskOverlayVersion,
} from "@/lib/undo";
import {
  ScheduleTechnicalFailure,
  ensureSentence,
  availability as availabilityApi,
  scheduling,
  tasks as tasksApi,
} from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useIsMobile } from "@/hooks/use-mobile";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PageHeader,
  PageShell,
  SectionCard,
  EmptyState,
} from "@/components/page-kit";
import { DateLeaf, DueChip } from "@/components/study-kit";
import { GridLegend, WeekGrid, type GridBlock, type GridColumn } from "@/components/week-grid";
import { WeekLoad, WeekLoadLegend, type DayLoad } from "@/components/week-load";
import { SessionDrawer } from "@/components/session-drawer";
import { RecordOutcomeDialog } from "@/components/record-outcome-dialog";
import { PendingPlanBanner, SchedulePreview } from "@/components/schedule-preview";
import { PlanGenerationDialog } from "@/components/plan-generation-dialog";
import { UnscheduledWorkList } from "@/components/unscheduled-work-list";
import type { AcademicTask } from "@/types/task";
import type { StudySession } from "@/types/session";
import type { ScheduleProposal } from "@/types/schedule";
import { SWR_KEYS } from "@/lib/swr-keys";
import { useAccountTimezone } from "@/hooks/use-account-timezone";
import { useNow } from "@/hooks/use-now";

const DEFAULT_RANGE = { start: 8, end: 22 };

function weekStart(date: Date, timeZone: string): Date {
  const day = startOfDay(date, timeZone);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

export default function CalendarPage() {
  const timeZone = useAccountTimezone();
  const router = useRouter();
  const now = useNow();
  const isMobile = useIsMobile();
  const [chosenView, setChosenView] = useState<"week" | "day" | "agenda" | null>(null);
  const view = chosenView ?? (isMobile ? "agenda" : "week");
  const singleDay = view === "day" || (view === "agenda" && isMobile);
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date(), timeZone));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AcademicTask | null>(null);

  const [selectedSession, setSelectedSession] = useState<StudySession | null>(null);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [outcomeSession, setOutcomeSession] = useState<StudySession | null>(null);

  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isGenerating, setGenerating] = useState(false);
  const [technicalFailure, setTechnicalFailure] = useState<string | null>(null);

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

  const isLoading =
    tasks.isLoading || windows.isLoading || periods.isLoading || schedule.isLoading;
  const loadError = tasks.error ?? windows.error ?? periods.error ?? schedule.error;

  // A deletion still inside its undo window already reads as gone, along
  // with that task's sessions.
  const overlayVersion = useTaskOverlayVersion();
  const allTasks = useMemo(() => {
    void overlayVersion;
    return applyTaskOverlays(tasks.data ?? []);
  }, [tasks.data, overlayVersion]);
  const allWindows = useMemo(() => windows.data ?? [], [windows.data]);
  const allPeriods = useMemo(() => periods.data ?? [], [periods.data]);
  const sessions = useMemo(() => {
    void overlayVersion;
    return labelSessions(
      (schedule.data?.sessions ?? []).filter((session) => !isTaskRemoved(session.taskId)),
      allTasks,
    );
  }, [schedule.data, overlayVersion, allTasks]);

  /** A revision waits for review the moment it exists (SPEC §14.1). */
  const pendingPlan = revision.data ?? proposal;

  const weekDays = useMemo(() => {
    const start = weekStart(anchor, timeZone);
    return Array.from({ length: 7 }, (_, i) => addZonedDays(start, i, timeZone));
  }, [anchor, timeZone]);
  const days = useMemo(
    () => (singleDay ? [startOfDay(anchor, timeZone)] : weekDays),
    [anchor, singleDay, timeZone, weekDays],
  );

  const rangeStart = days[0];
  const rangeEnd = useMemo(
    () => addZonedDays(days[days.length - 1], 1, timeZone),
    [days, timeZone],
  );

  const freeIntervals = useMemo(
    () => subtractPeriods(expandWindows(allWindows, rangeStart, rangeEnd, timeZone), allPeriods),
    [allWindows, allPeriods, rangeStart, rangeEnd, timeZone],
  );
  const blockedIntervals = useMemo(
    () => expandUnavailablePeriods(allPeriods, rangeStart, rangeEnd, timeZone),
    [allPeriods, rangeStart, rangeEnd, timeZone],
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
      min = Math.min(min, inTimeZone(session.startTime, timeZone).getHours());
      max = Math.max(max, inTimeZone(session.endTime, timeZone).getHours() + 1);
    }
    for (const interval of blockedIntervals) {
      min = Math.min(min, inTimeZone(interval.start, timeZone).getHours());
      max = Math.max(max, inTimeZone(interval.end, timeZone).getHours() + 1);
    }
    if (min > max) return DEFAULT_RANGE;
    return { start: Math.max(0, min - 1), end: Math.min(24, Math.max(max + 1, min + 6)) };
  }, [allWindows, blockedIntervals, sessions, timeZone]);
  const todayKey = dayKey(now, timeZone);
  const columns: GridColumn[] = useMemo(() => {
    return days.map((day) => ({
      key: dayKey(day, timeZone),
      label: DAY_NAMES_SHORT[inTimeZone(day, timeZone).getDay()],
      sublabel: String(inTimeZone(day, timeZone).getDate()),
      month: formatDate(day, timeZone, { month: "short" }),
      isToday: dayKey(day, timeZone) === todayKey,
    }));
  }, [days, timeZone, todayKey]);

  const blocks: GridBlock[] = useMemo(() => {
    const out: GridBlock[] = [];
    const visible = new Set(days.map((day) => dayKey(day, timeZone)));

    const pushCapacity = (
      intervals: { start: Date; end: Date }[],
      variant: "available" | "blocked",
      prefix: string,
    ) => {
      intervals.forEach((interval, index) => {
        for (const day of days) {
          const dayStart = startOfDay(day, timeZone);
          const dayEnd = addZonedDays(dayStart, 1, timeZone);
          const start = interval.start < dayStart ? dayStart : interval.start;
          const end = interval.end > dayEnd ? dayEnd : interval.end;
          if (end <= start) continue;
          out.push({
            id: `${prefix}-${index}-${dayKey(day, timeZone)}`,
            columnKey: dayKey(day, timeZone),
            start: minutesSinceMidnight(start, timeZone),
            end: minutesSinceMidnight(end, timeZone) === 0 ? 1440 : minutesSinceMidnight(end, timeZone),
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
      const key = dayKey(start, timeZone);
      if (!visible.has(key)) continue;
      out.push({
        id: session.id,
        columnKey: key,
        start: minutesSinceMidnight(start, timeZone),
        end: minutesSinceMidnight(session.endTime, timeZone),
        variant: "session",
        durationMinutes: session.plannedDuration,
        label: session.taskTitle,
        dotClassName: CATEGORY_CONFIG[session.category]?.dot,
        meta: `${formatClock(session.startTime, timeZone)}–${formatClock(session.endTime, timeZone)}`,
        title: `${session.taskTitle} · ${formatClock(session.startTime, timeZone)}–${formatClock(session.endTime, timeZone)}`,
        settled: Boolean(session.outcome),
        attention: session.isAwaitingOutcome,
        onSelect: () => {
          setSelectedSession(session);
          setSessionDrawerOpen(true);
        },
      });
    }

    return out;
  }, [freeIntervals, blockedIntervals, sessions, days, timeZone]);

  const deadlinesByDay = useMemo(() => {
    const map = new Map<string, AcademicTask[]>();
    for (const task of allTasks) {
      if (task.status === "Completed") continue;
      const key = dayKey(new Date(task.deadline), timeZone);
      const bucket = map.get(key);
      if (bucket) bucket.push(task);
      else map.set(key, [task]);
    }
    return map;
  }, [allTasks, timeZone]);

  const agenda = useMemo(() => {
    const from = startOfDay(now, timeZone);
    const to = addZonedDays(from, 14, timeZone);
    return allTasks
      .filter((task) => task.status !== "Completed")
      .filter((task) => {
        const due = new Date(task.deadline);
        return due >= from && due < to;
      })
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  }, [allTasks, timeZone, now]);

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
    const visible = new Set(days.map((day) => dayKey(day, timeZone)));
    const scheduled = sessions
      .filter((session) => visible.has(dayKey(new Date(session.startTime), timeZone)))
      .reduce((sum, session) => sum + session.plannedDuration, 0);
    const due = days.reduce((sum, day) => sum + (deadlinesByDay.get(dayKey(day, timeZone))?.length ?? 0), 0);
    return { free, blocked, scheduled, due };
  }, [freeIntervals, blockedIntervals, sessions, days, deadlinesByDay, timeZone]);

  /** The whole week around the anchor, even when one day is on screen. */
  const weekLoad: DayLoad[] = useMemo(() => {
    const free = minutesByDay(
      allWindows,
      allPeriods,
      weekDays[0],
      addZonedDays(weekDays[6], 1, timeZone),
      timeZone,
    );
    const planned = new Map<string, number>();
    for (const session of sessions) {
      const key = dayKey(new Date(session.startTime), timeZone);
      planned.set(key, (planned.get(key) ?? 0) + session.plannedDuration);
    }
    return weekDays.map((day) => {
      const key = dayKey(day, timeZone);
      const zoned = inTimeZone(day, timeZone);
      return {
        key,
        label: DAY_NAMES_SHORT[zoned.getDay()],
        longLabel: formatDate(day, timeZone, { weekday: "long", day: "numeric", month: "long" }),
        dayNumber: String(zoned.getDate()),
        free: free.get(key) ?? 0,
        planned: planned.get(key) ?? 0,
        deadlines: deadlinesByDay.get(key)?.length ?? 0,
        isToday: key === todayKey,
      };
    });
  }, [allWindows, allPeriods, weekDays, sessions, deadlinesByDay, timeZone, todayKey]);

  const nowMarker = days.some((day) => dayKey(day, timeZone) === dayKey(now, timeZone))
    ? { columnKey: dayKey(now, timeZone), minutes: minutesSinceMidnight(now, timeZone) }
    : undefined;

  const title = singleDay
    ? formatDate(anchor, timeZone, { weekday: "long", day: "numeric", month: "long" })
    : `${formatDate(days[0], timeZone, { day: "numeric", month: "short" })} – ${formatDate(days[6], timeZone, { day: "numeric", month: "short", year: "numeric" })}`;

  const shift = (direction: number) =>
    setAnchor(addZonedDays(anchor, direction * (singleDay ? 1 : 7), timeZone));

  /** Whether the view is already showing today (mobile) or this week. */
  const isCurrentPeriod = singleDay
    ? dayKey(anchor, timeZone) === dayKey(now, timeZone)
    : dayKey(weekStart(anchor, timeZone), timeZone) === dayKey(weekStart(now, timeZone), timeZone);

  const selectedTask = selectedSession
    ? (allTasks.find((task) => task.id === selectedSession.taskId) ?? null)
    : null;

  async function generate() {
    // Without hours or an open task there is nothing to plan; point at the
    // missing step instead of letting the planner come back empty.
    if (windows.data?.length === 0) {
      toast.info("Set your study hours first", {
        description: "StudyFlow plans study sessions inside the hours you are free each week.",
        action: { label: "Set hours", onClick: () => router.push("/availability") },
      });
      return;
    }
    if (tasks.data && !allTasks.some((task) => task.status !== "Completed")) {
      toast.info("Add a task first", {
        description: "Plan my time needs at least one unfinished task to find time for.",
        action: {
          label: "Add task",
          onClick: () => {
            setEditingTask(null);
            setDialogOpen(true);
          },
        },
      });
      return;
    }
    setGenerating(true);
    setTechnicalFailure(null);
    try {
      // A deletion still inside its undo window must land first, or the
      // planner would find time for a task that is about to disappear.
      await flushPendingActions();
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
    windows.reload();
    periods.reload();
    schedule.reload();
    revision.reload();
  }

  function deleteTask(target: AcademicTask) {
    scheduleUndoable({
      key: `delete:${target.id}`,
      message: "Task deleted",
      description: target.title,
      overlay: { taskId: target.id, removed: true },
      commit: () => tasksApi.deleteTask(target.id),
      onError: (cause) => describeError(cause),
    });
  }

  /** Picking a day from the week strip opens that day. */
  function openDay(key: string) {
    const day = weekDays.find((candidate) => dayKey(candidate, timeZone) === key);
    /* c8 ignore next -- the strip only offers days of the week on screen. */
    if (!day) return;
    setAnchor(day);
    if (!singleDay) setChosenView("day");
  }

  const weekVerdict =
    weekSummary.free === 0 && weekSummary.scheduled === 0
      ? `No study time ${singleDay ? "this day" : "this week"}`
      : weekSummary.scheduled === 0
        ? `${formatDuration(weekSummary.free)} free, nothing planned yet`
        : `${formatDuration(weekSummary.scheduled)} planned, ${formatDuration(Math.max(0, weekSummary.free - weekSummary.scheduled))} still free`;

  return (
    <PageShell>
      <PageHeader
        icon={CalendarDays}
        eyebrow="Planning"
        title="Calendar"
        description="When you study, what is due, and whether the week fits."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setEditingTask(null);
                setDialogOpen(true);
              }}
            >
              <Plus />
              Add task
            </Button>
            <Button
              onClick={() => void generate()}
              disabled={isGenerating}
              aria-busy={isGenerating}
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Plan my time
            </Button>
          </>
        }
      />

      {!isLoading && !loadError && allWindows.length === 0 && (
        <Callout title="Set your study hours first" icon={CalendarDays} className="frame-hatch rounded-xl border-primary/20" actions={<Button nativeButton={false} render={<Link href="/availability" />}>Set study hours</Button>}>
          Choose when you are free each week. Then add your coursework and use Plan my time to build a schedule you can review.
        </Callout>
      )}

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
          {ensureSentence(technicalFailure)} This is a problem on our side, not a sign that
          your work does not fit. Your current plan has not changed.
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

      {/* ── The week at a glance: one sentence, two side facts, seven days ── */}
      <Card className="rise-in min-w-0">
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{singleDay ? "This day" : "This week"}</p>
              {isLoading ? (
                <Skeleton className="mt-1.5 h-7 w-56" />
              ) : (
                <p className="mt-1 text-2xl leading-tight tabular-nums font-semibold tracking-tight">{weekVerdict}</p>
              )}
            </div>
            <dl className="flex gap-6 text-sm">
              <div title="Time your exceptions take out of your study hours">
                <dt className="text-xs text-muted-foreground">Blocked</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {isLoading ? "–" : formatDuration(weekSummary.blocked)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {weekSummary.due === 1 ? "Deadline here" : "Deadlines here"}
                </dt>
                <dd
                  className={cn(
                    "mt-0.5 font-medium tabular-nums",
                    !isLoading && weekSummary.due > 0 && "text-deficit",
                  )}
                >
                  {isLoading ? "–" : weekSummary.due}
                </dd>
              </div>
            </dl>
          </div>

          <WeekLoad
            days={weekLoad}
            loading={isLoading}
            selectedKey={singleDay ? dayKey(anchor, timeZone) : undefined}
            onSelect={openDay}
          />
          <WeekLoadLegend className="justify-center @2xl/dashboard:justify-start" />
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-6 @5xl/dashboard:grid-cols-[minmax(0,1fr)_16rem]">
        <Card className="min-w-0">
          <Tabs className="flex-1 gap-0" value={view} onValueChange={(value) => {
            if (value === "week" || value === "day" || value === "agenda") setChosenView(value);
          }}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-1 pt-1">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {/*
                The middle button used to read "Today" and sat flush against the
                next-week chevron, so a click near its edge landed on the arrow
                and appeared to jump a week forward. It says which period it
                returns to, is wide enough to hit, and is disabled once you are
                already there, so a mis-click can no longer move anything.
              */}
              <div className="flex items-center rounded-lg border bg-card shadow-xs">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-e-none"
                  onClick={() => shift(-1)}
                  aria-label={singleDay ? "Previous day" : "Previous week"}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none border-x px-3.5 disabled:opacity-100 disabled:text-muted-foreground"
                  onClick={() => setAnchor(startOfDay(new Date(), timeZone))}
                  disabled={isCurrentPeriod}
                >
                  {singleDay ? "Today" : "This week"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-s-none"
                  onClick={() => shift(1)}
                  aria-label={singleDay ? "Next day" : "Next week"}
                >
                  <ChevronRight />
                </Button>
              </div>
              <CardTitle className="text-base tabular-nums">{title}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger
                  render={
                    <Button variant="ghost" size="sm">
                      <CalendarDays />
                      Jump to
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0" align="end">
                  <DatePicker
                    mode="single"
                    selected={anchor}
                    onSelect={(date) => date && setAnchor(
                      zonedCalendarDate(date.getFullYear(), date.getMonth(), date.getDate(), timeZone),
                    )}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              <TabsList aria-label="Schedule view" className="h-9">
                <TabsTrigger value="week" className="px-3">Week</TabsTrigger>
                <TabsTrigger value="day" className="px-3">Day</TabsTrigger>
                <TabsTrigger value="agenda" className="px-3">Agenda</TabsTrigger>
              </TabsList>
            </div>
          </CardHeader>
          {(["week", "day", "agenda"] as const).map((panelView) => (
          <TabsContent key={panelView} value={panelView} keepMounted className="min-w-0">
          {panelView === view && <>
          <CardContent className="overflow-hidden p-0">
          {isLoading ? (
            <Skeleton className="m-(--card-spacing) h-[30rem] rounded-lg" />
          ) : view === "agenda" ? (
            <StudyAgenda columns={columns} blocks={blocks} deadlines={deadlinesByDay} timeZone={timeZone} emptyAction={allWindows.length === 0 ? <Button nativeButton={false} render={<Link href="/availability" />}>Set study hours</Button> : <Button onClick={() => void generate()} disabled={isGenerating}>Plan my time</Button>} />
          ) : (
            <WeekGrid
              className="rounded-none border-0"
              ariaLabel="Study calendar"
              columns={columns}
              blocks={blocks}
              hourStart={hourRange.start}
              hourEnd={hourRange.end}
              now={nowMarker}
              fit
              emptyContent={weekSummary.due === 0 ? <EmptyState icon={CalendarDays} title="No sessions planned" action={allWindows.length === 0 ? <Button nativeButton={false} render={<Link href="/availability" />}>Set study hours</Button> : <Button onClick={() => void generate()} disabled={isGenerating}>Plan my time</Button>}>Choose your study hours, add your tasks, then build a plan for this {singleDay ? "day" : "week"}.</EmptyState> : undefined}
              renderLane={(column) => {
                const due = deadlinesByDay.get(column.key) ?? [];
                if (due.length === 0) return null;
                return (
                  <>
                    {due.slice(0, 2).map((task) => (
                      <Link
                        key={task.id}
                        href={`/tasks/${task.id}`}
                        title={`${task.title} — due ${formatClock(task.deadline, timeZone)}`}
                        className="flex gap-1 rounded-sm bg-deficit-soft px-1.5 py-1 text-start text-[0.6875rem] font-medium leading-tight text-foreground transition-colors duration-150 hover-fine:bg-deficit/20"
                      >
                        <Flag className="mt-px size-2.5 shrink-0 text-deficit" aria-hidden />
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
          </CardContent>
          {view !== "agenda" && blocks.length > 0 && <CardFooter><GridLegend showDeadline showSession /></CardFooter>}
          </>}
          </TabsContent>
          ))}
          </Tabs>
        </Card>

        {/* ── Task sidebar (SPEC §17.3) ─────────────────────── */}
        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle>Your tasks</CardTitle>
            <p className="text-xs text-muted-foreground">Where each open task stands in the plan.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-4/5" />
              </div>
            ) : allTasks.length === 0 ? (
              <div className="flex flex-col items-start gap-3 py-1">
                <p className="text-sm text-muted-foreground">
                  No tasks yet. Add your coursework and StudyFlow will find time for it.
                </p>
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/tasks" />}>
                  Go to tasks
                </Button>
              </div>
            ) : (
              <>
                <TaskGroup title="Overdue" tasks={grouped.overdue} tone="deficit" />
                <TaskGroup title="No slot yet" tasks={grouped.unscheduled} tone="warning" />
                <TaskGroup title="Scheduled" tasks={grouped.active} tone="primary" />
                <TaskGroup title="Done" tasks={grouped.completed} tone="surplus" muted />
                {grouped.overdue.length + grouped.unscheduled.length === 0 && (
                  <p className="flex items-center gap-2 rounded-lg bg-surplus/10 px-3 py-2 text-xs text-surplus">
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                    Everything has a slot.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unscheduled Work, with its explanation and remedies (SPEC §17.3). */}
      {pendingPlan && pendingPlan.unscheduledWork.length > 0 && (
        <SectionCard
          title="Work with no slot"
          description="Open work StudyFlow could not place in your study time."
          action={<Badge variant="destructive">{pendingPlan.unscheduledWork.length}</Badge>}
        >
          <UnscheduledWorkList items={pendingPlan.unscheduledWork} />
        </SectionCard>
      )}

      <SectionCard
        title="Upcoming deadlines"
        description={`${agenda.length} in the next 14 days.`}
        action={
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/tasks" />}>
            All tasks
          </Button>
        }
        flush
      >
        {isLoading ? (
          <div className="space-y-2 p-(--card-spacing)">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : agenda.length === 0 ? (
          <p className="p-(--card-spacing) text-sm text-muted-foreground">
            Nothing due in the next two weeks.
          </p>
        ) : (
          <ul className="divide-y">
            {agenda.map((task) => {
              const due = new Date(task.deadline);
              const phrase = describeDeadline(task.deadline, timeZone);
              return (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex items-center gap-4 px-(--card-spacing) py-3 transition-colors duration-150 hover-fine:bg-muted/40 compact:py-2"
                  >
                    <DateLeaf date={due} urgent={phrase.urgent} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{task.title}</span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          aria-hidden
                          className={cn("size-1.5 shrink-0 rounded-full", CATEGORY_CONFIG[task.category].dot)}
                        />
                        <span className="truncate">
                          {CATEGORY_CONFIG[task.category].label} · {formatDate(due, timeZone, { weekday: "short" })}{" "}
                          {formatClock(due, timeZone)}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-xs tabular-nums">
                      <DueChip deadline={task.deadline} />
                      <span className="text-muted-foreground">
                        {formatDuration(task.remainingDuration)} left
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SessionDrawer
        session={selectedSession}
        task={selectedTask}
        open={sessionDrawerOpen}
        onOpenChange={setSessionDrawerOpen}
        onOpenChangeComplete={(next) => {
          if (!next) setSelectedSession(null);
        }}
        onEditTask={() => {
          setEditingTask(selectedTask);
          setSessionDrawerOpen(false);
          setDialogOpen(true);
        }}
        onDeleteTask={() => {
          setSessionDrawerOpen(false);
          if (selectedTask) deleteTask(selectedTask);
        }}
        onRecordOutcome={() => {
          setOutcomeSession(selectedSession);
          setSessionDrawerOpen(false);
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

      <PlanGenerationDialog open={isGenerating} />

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        onSaved={(task) => {
          setEditingTask(null);
          toast.success(editingTask ? "Task updated" : "Task added");
          void task;
        }}
      />
    </PageShell>
  );
}

const GROUP_TONES = {
  deficit: { dot: "bg-deficit", count: "text-deficit" },
  warning: { dot: "bg-warning", count: "text-warning" },
  primary: { dot: "bg-primary", count: "text-muted-foreground" },
  surplus: { dot: "bg-surplus", count: "text-muted-foreground" },
} as const;

/** One status group in the task panel. Empty groups are left out entirely. */
function TaskGroup({
  title,
  tasks,
  tone,
  muted,
}: {
  title: string;
  tasks: AcademicTask[];
  tone: keyof typeof GROUP_TONES;
  muted?: boolean;
}) {
  if (tasks.length === 0) return null;
  const colors = GROUP_TONES[tone];
  return (
    <section>
      <h3 className="flex items-center gap-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", colors.dot)} aria-hidden />
        {title}
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span className={cn("font-medium tabular-nums", colors.count)}>{tasks.length}</span>
      </h3>
      <ul className="flex flex-col">
        {tasks.slice(0, 6).map((task) => (
          <li key={task.id}>
            <Link
              href={`/tasks/${task.id}`}
              className={cn(
                "-mx-2 flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] transition-colors duration-150 hover-fine:bg-muted/50 hover-fine:text-foreground compact:py-1",
                muted ? "text-muted-foreground line-through decoration-muted-foreground/40" : "text-foreground",
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
    </section>
  );
}
