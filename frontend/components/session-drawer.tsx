"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock, Pencil, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { DetailDrawer } from "@/components/detail-drawer";
import { formatDuration, CATEGORY_CONFIG } from "@/lib/constants";
import { describeDeadline, formatClock } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { StudySession } from "@/types/session";
import type { AcademicTask } from "@/types/task";

const OUTCOME_STYLE = {
  Completed: { label: "Finished", icon: CheckCircle2, tone: "text-surplus" },
  Delayed: { label: "Partly done", icon: Clock, tone: "text-muted-foreground" },
  Missed: { label: "Missed", icon: XCircle, tone: "text-deficit" },
} as const;

/**
 * The task/session drawer SPEC §17.3 requires: opened by clicking a session,
 * carrying view/edit/delete of the task plus Record Outcome.
 *
 * Record Outcome is only offered once the session is actually in the past —
 * there is nothing truthful to report about a session that has not happened,
 * and offering it early invites guesses that become behaviour history.
 */
export function SessionDrawer({
  session,
  task,
  open,
  onOpenChange,
  onEditTask,
  onDeleteTask,
  onRecordOutcome,
}: {
  session: StudySession | null;
  task: AcademicTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditTask: () => void;
  onDeleteTask: () => void;
  onRecordOutcome: () => void;
}) {
  if (!session) return null;

  const start = new Date(session.startTime);
  const end = new Date(session.endTime);
  const isPast = end < new Date();
  const outcome = session.outcome ? OUTCOME_STYLE[session.outcome] : null;
  const due = task ? describeDeadline(task.deadline) : null;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={session.taskTitle}
      description={
        <>
          {start.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {" · "}
          {formatClock(start)}–{formatClock(end)}
        </>
      }
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={onDeleteTask}
          >
            <Trash2 />
            Delete task
          </Button>
          <Button variant="outline" size="sm" onClick={onEditTask}>
            <Pencil />
            Edit task
          </Button>
          {isPast && !session.outcome && (
            <Button size="sm" onClick={onRecordOutcome}>
              Record what happened
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {session.isAwaitingOutcome && (
          <Callout
            tone="warning"
            icon={CalendarClock}
            title="This session is waiting on you"
            actions={
              <Button size="sm" onClick={onRecordOutcome}>
                Record what happened
              </Button>
            }
          >
            Until you tell StudyFlow how it went, this work still counts as remaining.
          </Callout>
        )}

        {outcome && (
          <div className="flex items-center gap-2">
            <outcome.icon className={cn("size-4", outcome.tone)} aria-hidden />
            <span className="text-sm font-medium">{outcome.label}</span>
            {session.actualDuration !== undefined && session.actualDuration > 0 && (
              <span className="text-sm text-muted-foreground">
                · {formatDuration(session.actualDuration)} worked
              </span>
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-4 text-sm">
          <Fact label="Planned" value={formatDuration(session.plannedDuration)} />
          <Fact label="Category" value={CATEGORY_CONFIG[session.category].label} />
          {task && <Fact label="Course" value={task.course || "—"} />}
          {task && due && (
            <Fact
              label="Task deadline"
              value={new Date(task.deadline).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}
              tone={due.urgent ? "deficit" : undefined}
            />
          )}
        </dl>

        {task && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{task.status}</Badge>
              {task.priority === "High" && <Badge variant="outline">High priority</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {formatDuration(task.remainingDuration)} of this task is still to do.
            </p>
            <Link
              href={`/tasks/${session.taskId}`}
              className="inline-block text-sm font-medium underline-offset-4 hover:underline"
            >
              Open the full task →
            </Link>
          </div>
        )}
      </div>
    </DetailDrawer>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "deficit";
}) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate tabular-nums",
          tone === "deficit" ? "font-medium text-deficit" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
