"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ArrowLeft, Loader2, Pencil, Play, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { formatDuration, CATEGORY_CONFIG, PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { TaskFormDialog } from "@/components/task-form-dialog";
import type { AcademicTask } from "@/types/task";

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
  const { data: task, error, isLoading, reload, setData } = useApi(load);

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(action: string, fn: () => Promise<void>, message: string) {
    setBusy(action);
    try {
      await fn();
      toast.success(message);
      reload();
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
            onClick={() =>
              void run("finish", () => tasksApi.finishTaskEarly(task.id), "Task finished")
            }
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
          onClick={() => void remove()}
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
      <Card>
        <CardContent className="grid gap-x-8 gap-y-5 p-6 sm:grid-cols-2">
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

          <Fact label="Planned duration">{formatDuration(task.plannedDuration)}</Fact>

          <Fact label="Remaining">{formatDuration(task.remainingDuration)}</Fact>

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
        </CardContent>
      </Card>

      {task.status !== "Not Started" && (
        <p className="font-mono text-xs text-muted-foreground">
          The original estimate is frozen once a task has been started, so it can no
          longer be edited.
        </p>
      )}

      <TaskFormDialog
        open={editing}
        onOpenChange={setEditing}
        task={task}
        onSaved={(saved: AcademicTask) => setData(saved)}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/tasks"
      className="inline-flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
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
          "mt-1 font-mono text-sm",
          emphasis ? "font-medium text-deficit" : "text-foreground",
        )}
      >
        {children}
      </p>
    </div>
  );
}
