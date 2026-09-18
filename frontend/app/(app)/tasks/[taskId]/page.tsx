"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Pencil,
  Play,
  Check,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, scheduling, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { formatDuration, CATEGORY_CONFIG, PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RecordOutcomeDialog } from "@/components/record-outcome-dialog";
import { SchedulePreview } from "@/components/schedule-preview";
import { PersistedEstimateNote } from "@/components/adaptive-estimate";
import { SectionCard } from "@/components/page-kit";
import { formatClock } from "@/lib/datetime";
import { applyRecordedOutcome } from "@/lib/outcome-ui";
import { DAY_NAMES_SHORT } from "@/lib/constants";
import type { AcademicTask } from "@/types/task";
import type { StudySession } from "@/types/session";
import type { ScheduleProposal } from "@/types/schedule";
import { activeScheduleKey, SWR_KEYS, taskDetailKey } from "@/lib/swr-keys";

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = use(params);
  const router = useRouter();

  const load = useCallback(
    (signal: AbortSignal) => tasksApi.getTask(taskId, signal),
    [taskId],
  );
  const { data: task, error, isLoading, reload, setData } = useApi(taskDetailKey(taskId), load);

  const loadTasks = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const allTasks = useApi(SWR_KEYS.tasks, loadTasks);

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [outcomeSession, setOutcomeSession] = useState<StudySession | null>(null);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const loadSchedule = useCallback(
    (signal: AbortSignal) => scheduling.getActiveSchedule(signal, allTasks.data ?? []),
    [allTasks.data],
  );
  const schedule = useApi(
    activeScheduleKey(allTasks.data),
    loadSchedule,
  );
  /** Every session belonging to this task, newest first (SPEC §17.4). */
  const taskSessions = (schedule.data?.sessions ?? [])
    .filter((session) => session.taskId === taskId)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  async function run(action: string, fn: () => Promise<void>, message: string) {
    setBusy(action);
    try {
      await fn();
      toast.success(message);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast.error("Start the task before finishing it early.");
      } else {
        toast.error(describeError(cause));
      }
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await tasksApi.deleteTask(taskId);
      toast.success("Task deleted");
      router.push("/tasks");
    } catch (cause) {
      toast.error(describeError(cause));
      setBusy(null);
    }
  }

  if (error) {
    const missing = error instanceof ApiError && error.isNotFound;
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <BackLink />
        <Alert variant="destructive" className="mt-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{missing ? "This task no longer exists." : describeError(error)}</span>
            {!missing && (
              <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading || !task) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <BackLink />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const category = CATEGORY_CONFIG[task.category];
  const priority = PRIORITY_CONFIG[task.priority];
  const status = STATUS_CONFIG[task.status];
  const deadline = new Date(task.deadline);
  const overdue = task.status === "Overdue";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <BackLink />

      {/* ── Heading ─────────────────────────────── */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn("rounded-md border-0", category.bg, category.color)}>
            {category.label}
          </Badge>
          <Badge className={cn("rounded-md border-0", priority.bg, priority.color)}>
            {priority.label}
          </Badge>
          <Badge className={cn("flex items-center gap-1.5 rounded-md border-0", status.bg, status.color)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
            {status.label}
          </Badge>
        </div>

        <h1 className="font-display text-3xl font-bold tracking-tight">{task.title}</h1>

        {task.course && (
          <p className="text-sm text-muted-foreground">{task.course}</p>
        )}
      </header>

      {/* ── Actions ─────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit
        </Button>

        {task.status === "Not Started" && (
          <Button
            size="sm"
            onClick={() => void run("start", () => tasksApi.startTask(task.id), "Task started")}
            disabled={busy !== null}
          >
            {busy === "start" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Start
          </Button>
        )}

        {task.status === "In Progress" && (
          <Button
            size="sm"
            onClick={() => setConfirmFinish(true)}
            disabled={busy !== null}
          >
            {busy === "finish" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            Finish early
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          className="ml-auto border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          disabled={busy !== null}
        >
          {busy === "delete" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          Delete
        </Button>
      </div>

      {/* ── Facts ───────────────────────────────── */}
      <SectionCard title="Details" contentClassName="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Fact label="Deadline" emphasis={overdue}>
            {deadline.toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {" · "}
            {deadline.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </Fact>

          <Fact label="Original estimate">{formatDuration(task.originalEstimate)}</Fact>

          {task.adaptiveEstimate !== undefined && (
            <Fact label="Adaptive estimate">{formatDuration(task.adaptiveEstimate)}</Fact>
          )}

          <Fact label={`Planned duration · ${task.plannedSource}`}>
            {formatDuration(task.plannedDuration)}
          </Fact>

          <Fact label="Actual time worked">{formatDuration(task.actualDuration)}</Fact>

          <Fact label="Estimated remaining">{formatDuration(task.remainingDuration)}</Fact>

          <Fact label="Created">
            {new Date(task.createdAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </Fact>

          <Fact label="Last updated">
            {new Date(task.updatedAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </Fact>

          {task.notes && (
            <div className="sm:col-span-2">
              <Separator className="mb-5" />
              <p className="eyebrow">Notes</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{task.notes}</p>
            </div>
          )}
      </SectionCard>

      {task.status !== "Not Started" && (
        <Callout tone="info" title="The original estimate is locked">
          Once you start a task its first estimate is kept as a record, so you can see
          later how close it was. You can still change everything else.
        </Callout>
      )}

      {/* ── Saved adaptive estimate (SPEC §15.6) ───────────── */}
      {task.adaptiveEstimate !== undefined && (
        <PersistedEstimateNote
          originalEstimate={task.originalEstimate}
          adaptiveEstimate={task.adaptiveEstimate}
          plannedDuration={task.plannedDuration}
          plannedSource={task.plannedSource}
        />
      )}

      {/* ── Session history (SPEC §17.4) ───────────────────── */}
      <SectionCard
        title="Study sessions"
        action={
          schedule.isLoading ? undefined : (
            <span className="text-xs text-muted-foreground">{taskSessions.length} planned</span>
          )
        }
        flush
      >
        {schedule.isLoading ? (
          <div className="space-y-2 p-(--card-spacing)">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : taskSessions.length === 0 ? (
          <p className="p-(--card-spacing) text-sm text-muted-foreground">
            No sessions yet.{" "}
            <Link href="/calendar" className="font-medium underline underline-offset-4">
              Plan your time
            </Link>{" "}
            to book some.
          </p>
        ) : (
          <ul className="divide-y">
            {taskSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onRecord={() => setOutcomeSession(session)}
              />
            ))}
          </ul>
        )}
      </SectionCard>

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
        onRecorded={(result) =>
          applyRecordedOutcome(result, { setProposal, setPreviewOpen })
        }
      />

      <SchedulePreview
        proposal={proposal}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onAccepted={() => {
          setProposal(null);
        }}
        onRejected={() => setProposal(null)}
      />

      {/* SPEC §7.8 */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${task.title}”?`}
        description="This also removes its study sessions and the record of time you have already put in. It cannot be undone."
        confirmLabel="Delete task"
        destructive
        onConfirm={remove}
      />

      {/* SPEC §7.5 */}
      <ConfirmDialog
        open={confirmFinish}
        onOpenChange={setConfirmFinish}
        title={`Finish “${task.title}” now?`}
        description="StudyFlow will treat this task as done, drop its upcoming sessions, and keep the time you have already logged."
        confirmLabel="Mark it finished"
        onConfirm={() =>
          run("finish", () => tasksApi.finishTaskEarly(task.id), "Task finished")
        }
      />
    </div>
  );
}

const OUTCOME_STYLE = {
  Completed: { label: "Finished", icon: CheckCircle2, tone: "text-surplus" },
  Delayed: { label: "Partly done", icon: Clock, tone: "text-muted-foreground" },
  Missed: { label: "Missed", icon: XCircle, tone: "text-deficit" },
} as const;

function SessionRow({
  session,
  onRecord,
}: {
  session: StudySession;
  onRecord: () => void;
}) {
  const start = new Date(session.startTime);
  const style = session.outcome ? OUTCOME_STYLE[session.outcome] : null;
  const isPast = new Date(session.endTime) < new Date();

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-(--card-spacing) py-2.5">
      <span className="w-40 shrink-0 text-xs tabular-nums text-muted-foreground">
        {DAY_NAMES_SHORT[start.getDay()]} {start.getDate()}{" "}
        {start.toLocaleDateString(undefined, { month: "short" })} · {formatClock(start)}–
        {formatClock(session.endTime)}
      </span>

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatDuration(session.plannedDuration)}
      </span>

      <span className="ms-auto flex items-center gap-3">
        {style ? (
          <span className={cn("flex items-center gap-1.5 text-xs", style.tone)}>
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
      </span>
    </li>
  );
}

function BackLink() {
  return (
    <Link
      href="/tasks"
      className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      All tasks
    </Link>
  );
}

function Fact({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm tabular-nums",
          emphasis ? "font-medium text-deficit" : "text-foreground",
        )}
      >
        {children}
      </p>
    </div>
  );
}
