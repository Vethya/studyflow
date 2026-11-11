"use client";

import { use, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Callout } from "@/components/ui/callout";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Pencil,
  Play,
  Trash2,
  XCircle,
} from "@/components/icons";
import { toast } from "sonner";
import { ApiError, scheduling, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { DAY_NAMES_SHORT, formatDuration, STATUS_CONFIG } from "@/lib/constants";
import { CategoryTag, PageShell, SectionCard } from "@/components/page-kit";
import { DueChip, EffortBar, SectionLabel } from "@/components/study-kit";
import { cn } from "@/lib/utils";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { useConfirmDeleteTask } from "@/components/use-confirm-delete-task";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RecordOutcomeDialog } from "@/components/record-outcome-dialog";
import { SchedulePreview } from "@/components/schedule-preview";
import { PersistedEstimateNote } from "@/components/adaptive-estimate";
import { describeDeadline, formatClock, formatDate, inTimeZone } from "@/lib/datetime";
import { applyRecordedOutcome } from "@/lib/outcome-ui";
import { labelSessions } from "@/lib/session-labels";
import { applyTaskOverlays, scheduleUndoable, useTaskOverlayVersion } from "@/lib/undo";
import type { AcademicTask } from "@/types/task";
import type { StudySession } from "@/types/session";
import type { ScheduleProposal } from "@/types/schedule";
import { SWR_KEYS, taskDetailKey } from "@/lib/swr-keys";
import { useAccountTimezone } from "@/hooks/use-account-timezone";
import { useNow } from "@/hooks/use-now";

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const timeZone = useAccountTimezone();
  const { taskId } = use(params);
  const router = useRouter();
  const now = useNow();

  const load = useCallback(
    (signal: AbortSignal) => tasksApi.getTask(taskId, signal),
    [taskId],
  );
  const { data, error, isLoading, reload, setData } = useApi(taskDetailKey(taskId), load);

  const loadTasks = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const allTasks = useApi(SWR_KEYS.tasks, loadTasks);

  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [outcomeSession, setOutcomeSession] = useState<StudySession | null>(null);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // A finish still inside its undo window already reads as finished here.
  const overlayVersion = useTaskOverlayVersion();
  const task = useMemo(() => {
    void overlayVersion;
    return data ? (applyTaskOverlays([data])[0] ?? data) : data;
  }, [data, overlayVersion]);

  const loadSchedule = useCallback(
    (signal: AbortSignal) => scheduling.getActiveSchedule(signal),
    [],
  );
  const schedule = useApi(SWR_KEYS.activeSchedule, loadSchedule);
  const labeledSessions = labelSessions(schedule.data?.sessions ?? [], allTasks.data);
  /** Every session belonging to this task, newest first (SPEC §17.4). */
  const taskSessions = labeledSessions
    .filter((session) => session.taskId === taskId)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  async function start(current: AcademicTask) {
    const previousTasks = allTasks.data;
    const optimistic: AcademicTask = { ...current, status: "In Progress" };
    setData(optimistic);
    if (previousTasks) {
      allTasks.setData(previousTasks.map((item) => (item.id === taskId ? optimistic : item)));
    }
    setStarting(true);
    try {
      await tasksApi.startTask(current.id);
      toast.success("Task started");
    } catch (cause) {
      setData(current);
      if (previousTasks) allTasks.setData(previousTasks);
      toast.error(describeError(cause));
    } finally {
      setStarting(false);
    }
  }

  function finish(current: AcademicTask) {
    scheduleUndoable({
      key: `finish:${current.id}`,
      message: "Task finished",
      description: current.title,
      overlay: { taskId: current.id, patch: { status: "Completed", remainingDuration: 0 } },
      commit: () => tasksApi.finishTaskEarly(current.id),
      onError: (cause) => {
        reload();
        return cause instanceof ApiError && cause.status === 409
          ? "Start the task before marking it done."
          : describeError(cause);
      },
    });
  }

  function remove(current: AcademicTask) {
    scheduleUndoable({
      key: `delete:${current.id}`,
      message: "Task deleted",
      description: current.title,
      overlay: { taskId: current.id, removed: true },
      commit: () => tasksApi.deleteTask(current.id),
      onError: (cause) => describeError(cause),
    });
    router.push("/tasks");
  }

  const { requestDelete, dialog } = useConfirmDeleteTask(remove);

  if (error) {
    const missing = error instanceof ApiError && error.isNotFound;
    return (
      <PageShell width="narrow">
        <BackLink />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{missing ? "This task no longer exists." : describeError(error)}</span>
            {!missing && (
              <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
            )}
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  }

  if (isLoading || !task) {
    return (
      <PageShell width="narrow">
        <BackLink />
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-2/3" />
        </div>
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </PageShell>
    );
  }

  const status = STATUS_CONFIG[task.status];
  const completed = task.status === "Completed";
  const overdue = task.status === "Overdue";
  const due = describeDeadline(task.deadline, timeZone, now);
  const deadlineText = `${formatDate(task.deadline, timeZone, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })} · ${formatClock(task.deadline, timeZone)}`;
  const overPlan = task.actualDuration > task.plannedDuration;
  const recorded = taskSessions.filter((session) => session.outcome).length;
  const upcoming = taskSessions.filter((session) => new Date(session.startTime) > now).length;

  return (
    <PageShell width="narrow">
      <BackLink />

      {/* ── Heading ─────────────────────────────── */}
      <header className="rise-in space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <CategoryTag category={task.category} />
          {task.course && (
            <span className="min-w-0 wrap-break-word text-sm text-muted-foreground">{task.course}</span>
          )}
        </div>

        <h1 className="wrap-break-word text-[2rem] leading-tight @2xl/dashboard:text-[2.375rem] font-semibold tracking-tight">
          {task.title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className={cn("inline-flex items-center gap-1.5 font-medium", status.color)}>
            <span className={cn("size-2 rounded-full", status.dotColor)} aria-hidden />
            {status.label}
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                "flex h-3 items-end gap-px",
                task.priority === "High" ? "text-deficit" : "text-muted-foreground",
              )}
            >
              {[1, 2, 3].map((bar) => (
                <span
                  key={bar}
                  className={cn(
                    "w-[3px] rounded-[1px]",
                    bar === 1 ? "h-1.5" : bar === 2 ? "h-2.5" : "h-3",
                    bar <= (task.priority === "High" ? 3 : task.priority === "Medium" ? 2 : 1)
                      ? "bg-current"
                      : "bg-border",
                  )}
                />
              ))}
            </span>
            {task.priority} priority
          </span>
        </div>
      </header>

      {/* ── Actions ─────────────────────────────── */}
      <div className="rise-in flex flex-wrap items-center gap-2" style={{ "--stagger": 1 } as React.CSSProperties}>
        {task.status === "Not Started" && (
          <Button onClick={() => void start(task)} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <Play />}
            Start
          </Button>
        )}

        {task.status === "In Progress" && (
          <Button onClick={() => setConfirmFinish(true)}>
            <Check />
            Mark done
          </Button>
        )}

        <Button variant="outline" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>

        <Button
          variant="ghost"
          className="ms-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => requestDelete(task)}
          disabled={starting}
        >
          <Trash2 />
          Delete
        </Button>
      </div>

      {/* ── Effort: the one answer this page gives ─────────── */}
      <Card
        className="rise-in relative overflow-hidden"
        style={{ "--stagger": 2 } as React.CSSProperties}
      >
        <CardContent className="grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {completed ? "Finished" : "Work still to do"}
              </p>
              <p className="mt-1 text-4xl leading-none tabular-nums font-semibold tracking-tight">
                {completed ? formatDuration(task.actualDuration) : formatDuration(task.remainingDuration)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {completed
                  ? `of work put in, against ${formatDuration(task.plannedDuration)} planned`
                  : `left of ${formatDuration(task.plannedDuration)} planned`}
              </p>
            </div>

            <div className="text-end">
              <p className="text-xs text-muted-foreground">Deadline</p>
              <p
                className={cn(
                  "mt-1 text-sm font-medium tabular-nums",
                  (overdue || (!completed && due.urgent)) && "text-deficit",
                )}
              >
                {deadlineText}
              </p>
              <div className="mt-1.5 flex justify-end">
                <DueChip deadline={task.deadline} completed={completed} />
              </div>
            </div>
          </div>

          <EffortBar
            worked={task.actualDuration}
            remaining={task.remainingDuration}
            size="md"
          />

          <dl className="grid grid-cols-3 divide-x rounded-lg border text-sm">
            <Stat label="Worked" value={formatDuration(task.actualDuration)} />
            <Stat
              label="Planned"
              value={formatDuration(task.plannedDuration)}
              hint={task.plannedSource === "Adaptive" ? "Adjusted from your past tasks" : undefined}
            />
            <Stat
              label="Sessions"
              value={schedule.isLoading ? "–" : `${recorded} done`}
              hint={schedule.isLoading ? undefined : `${upcoming} coming up`}
            />
          </dl>

          {overPlan && !completed && (
            <p className="text-xs text-muted-foreground">
              You have put in more time than planned. That is normal for harder work; the
              remaining estimate is what StudyFlow schedules from.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 @3xl/dashboard:grid-cols-[minmax(0,1fr)_17rem]">
        {/* ── Main column ─────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* Session history (SPEC §17.4) */}
          <section aria-labelledby="task-sessions" className="space-y-3">
            <SectionLabel
              as="h2"
              action={
                schedule.isLoading ? undefined : (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {taskSessions.length} planned
                  </span>
                )
              }
            >
              <span id="task-sessions">Study sessions</span>
            </SectionLabel>

            {schedule.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : taskSessions.length === 0 ? (
              <div className="frame-hatch rounded-xl border border-dashed px-5 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No sessions yet.{" "}
                  <Link href="/calendar" className="font-medium text-foreground underline underline-offset-4">
                    Plan your time
                  </Link>{" "}
                  to book some.
                </p>
              </div>
            ) : (
              <ol className="relative">
                {taskSessions.map((session, index) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    now={now}
                    last={index === taskSessions.length - 1}
                    onRecord={() => setOutcomeSession(session)}
                  />
                ))}
              </ol>
            )}
          </section>

          {task.notes && (
            <section aria-labelledby="task-notes" className="space-y-3">
              <SectionLabel as="h2">
                <span id="task-notes">Notes</span>
              </SectionLabel>
              <div className="rounded-xl border bg-card px-5 py-4 text-sm leading-6 shadow-xs">
                <p className="whitespace-pre-wrap wrap-break-word">{task.notes}</p>
              </div>
            </section>
          )}
        </div>

        {/* ── Rail: the record ────────────────────── */}
        <aside className="flex min-w-0 flex-col gap-4">
          <SectionCard title="Details" contentClassName="grid gap-4">
            <Fact label="Original estimate" icon={task.status !== "Not Started" ? Lock : undefined}>
              {formatDuration(task.originalEstimate)}
            </Fact>
            {task.adaptiveEstimate !== undefined && (
              <Fact label="Adaptive estimate">{formatDuration(task.adaptiveEstimate)}</Fact>
            )}
            <Fact label={`Planned duration · ${task.plannedSource}`}>
              {formatDuration(task.plannedDuration)}
            </Fact>
            <Fact label="Actual time worked">{formatDuration(task.actualDuration)}</Fact>
            <Fact label="Estimated remaining">{formatDuration(task.remainingDuration)}</Fact>
            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <Fact label="Created">
                {formatDate(task.createdAt, timeZone, { day: "numeric", month: "short", year: "numeric" })}
              </Fact>
              <Fact label="Last updated">
                {formatDate(task.updatedAt, timeZone, { day: "numeric", month: "short", year: "numeric" })}
              </Fact>
            </div>
          </SectionCard>

          {task.status !== "Not Started" && (
            <Callout tone="info" icon={Lock} title="The original estimate is locked">
              Once you start a task its first estimate is kept as a record, so you can see
              later how close it was. You can still change everything else.
            </Callout>
          )}

          {/* Saved adaptive estimate (SPEC §15.6) */}
          {task.adaptiveEstimate !== undefined && (
            <PersistedEstimateNote
              originalEstimate={task.originalEstimate}
              adaptiveEstimate={task.adaptiveEstimate}
              plannedDuration={task.plannedDuration}
              plannedSource={task.plannedSource}
            />
          )}
        </aside>
      </div>

      <TaskFormDialog
        open={editing}
        onOpenChange={setEditing}
        task={task}
        onSaved={(saved: AcademicTask) => setData(saved)}
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
        existingSessions={schedule.data ? labeledSessions : undefined}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onAccepted={() => {
          setProposal(null);
        }}
        onRejected={() => setProposal(null)}
      />

      {/* SPEC §7.8 */}
      {dialog}

      {/* SPEC §7.5 */}
      <ConfirmDialog
        open={confirmFinish}
        onOpenChange={setConfirmFinish}
        title={`Finish “${task.title}” now?`}
        description="StudyFlow will treat this task as done, drop its upcoming sessions, and keep the time you have already logged."
        confirmLabel="Mark it finished"
        onConfirm={() => finish(task)}
      />
    </PageShell>
  );
}

const OUTCOME_STYLE = {
  Completed: { label: "Finished", icon: CheckCircle2, tone: "text-surplus", dot: "bg-surplus border-surplus" },
  Delayed: { label: "Partly done", icon: Clock, tone: "text-muted-foreground", dot: "bg-muted-foreground/60 border-muted-foreground/60" },
  Missed: { label: "Missed", icon: XCircle, tone: "text-deficit", dot: "bg-deficit border-deficit" },
} as const;

function SessionRow({
  session,
  now,
  last,
  onRecord,
}: {
  session: StudySession;
  now: Date;
  last: boolean;
  onRecord: () => void;
}) {
  const timeZone = useAccountTimezone();
  const start = inTimeZone(session.startTime, timeZone);
  const style = session.outcome ? OUTCOME_STYLE[session.outcome] : null;
  const isPast = new Date(session.endTime) < now;
  const waiting = !style && isPast;

  return (
    <li className="relative flex gap-4 pb-1">
      {/* The rail: a dot per session, joined by a hairline. */}
      <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
        <span
          className={cn(
            "relative z-10 mt-[1.0625rem] size-2.5 rounded-full border-2",
            style ? style.dot : waiting ? "border-deficit bg-card" : "border-primary bg-card",
          )}
        />
        {!last && <span className="absolute top-7 bottom-0 w-px bg-border" />}
      </span>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-3 py-2.5 compact:py-1.5",
          waiting && "bg-deficit/6",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium tabular-nums">
            {DAY_NAMES_SHORT[start.getDay()]} {start.getDate()}{" "}
            {formatDate(start, timeZone, { month: "short" })}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatClock(start, timeZone)}–{formatClock(session.endTime, timeZone)} ·{" "}
            {formatDuration(session.plannedDuration)}
          </p>
        </div>

        {style ? (
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", style.tone)}>
            <style.icon className="size-3.5" aria-hidden />
            {style.label}
            {session.actualDuration ? ` · ${formatDuration(session.actualDuration)}` : ""}
          </span>
        ) : isPast ? (
          <Button size="xs" variant="outline" onClick={onRecord}>
            Record what happened
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Upcoming</span>
        )}
      </div>
    </li>
  );
}

function BackLink() {
  return (
    <Link
      href="/tasks"
      className="group/back inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-150 ease-fluid group-hover/back:-translate-x-0.5" />
      All tasks
    </Link>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">
        {value}
        {hint && <span className="ms-1.5 text-xs font-normal text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}

function Fact({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {Icon && <Icon className="size-3" aria-label="Locked" />}
      </p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{children}</p>
    </div>
  );
}
