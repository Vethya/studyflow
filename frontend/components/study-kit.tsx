"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Check } from "@/components/icons";
import { CategoryTag } from "@/components/page-kit";
import { useAccountTimezone } from "@/hooks/use-account-timezone";
import { formatDuration, STATUS_CONFIG } from "@/lib/constants";
import { describeDeadline, formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { AcademicTask } from "@/types/task";

/**
 * StudyFlow's own components, layered on the shadcn primitives. Every screen
 * uses these for the same facts — a deadline, an amount of effort, a task —
 * so a student reads each fact the same way everywhere.
 */

/** A small-caps kicker followed by a hairline, like a ruled notebook heading. */
export function SectionLabel({
  children,
  action,
  className,
  as: Tag = "h2",
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3" | "p";
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Tag className="shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {children}
      </Tag>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      {action}
    </div>
  );
}

/**
 * A deadline in the one shared vocabulary ("Today", "3d", "2d over"). Urgency
 * is carried by an icon as well as colour.
 */
export function DueChip({
  deadline,
  completed = false,
  className,
}: {
  deadline: string;
  completed?: boolean;
  className?: string;
}) {
  const timeZone = useAccountTimezone();
  const due = describeDeadline(deadline, timeZone);
  const urgent = !completed && due.urgent;
  const Icon = completed ? Check : due.overdue ? AlertTriangle : CalendarClock;
  // Finished work has no urgency left, so "2d over" would read as overdue.
  const date = completed ? formatDate(deadline, timeZone, { day: "numeric", month: "short" }) : null;
  return (
    <span
      data-slot="due-chip"
      title={date ? `Was due ${date}` : due.long}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium tabular-nums",
        completed
          ? "text-muted-foreground"
          : due.overdue
            ? "bg-deficit/12 text-deficit"
            : urgent
              ? "text-deficit"
              : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span aria-hidden>{date ?? due.short}</span>
      <span className="sr-only">{completed ? "Completed" : due.long}</span>
    </span>
  );
}

/**
 * Effort put in against effort still estimated. Labelled as effort, never as
 * completion: a task can take longer than planned (FR-06-AC06).
 */
export function EffortBar({
  worked,
  remaining,
  label = "Effort put in",
  size = "sm",
  className,
}: {
  worked: number;
  remaining: number;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const total = worked + remaining;
  const percent = total > 0 ? Math.round((worked / total) * 100) : 0;
  const done = total > 0 && remaining === 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% — ${formatDuration(worked)} worked, ${formatDuration(remaining)} left`}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-muted",
        size === "sm" ? "h-1.5" : "h-2.5",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-fluid",
          done ? "bg-surplus" : "bg-primary",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** A torn-off calendar leaf: the month on the tab, the day in ink. */
export function DateLeaf({
  date,
  urgent = false,
  className,
}: {
  date: string | Date;
  urgent?: boolean;
  className?: string;
}) {
  const timeZone = useAccountTimezone();
  return (
    <span
      aria-hidden
      className={cn(
        "flex w-11 shrink-0 flex-col overflow-hidden rounded-md border bg-card text-center leading-none shadow-xs",
        urgent && "border-deficit/40",
        className,
      )}
    >
      <span
        className={cn(
          "py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider",
          urgent ? "bg-deficit/12 text-deficit" : "bg-muted text-muted-foreground",
        )}
      >
        {formatDate(date, timeZone, { month: "short" })}
      </span>
      <span className="py-1 text-lg tabular-nums font-semibold tracking-tight">
        {formatDate(date, timeZone, { day: "numeric" })}
      </span>
    </span>
  );
}

/** "On track" / "Over by 2h": a capacity verdict as a compact pill. */
export function VerdictBadge({
  tone,
  children,
  className,
}: {
  tone: "fits" | "over" | "neutral";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        tone === "fits" && "bg-surplus/12 text-surplus",
        tone === "over" && "bg-deficit/12 text-deficit",
        tone === "neutral" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "fits" && "bg-surplus",
          tone === "over" && "bg-deficit",
          tone === "neutral" && "bg-muted-foreground/50",
        )}
      />
      {children}
    </span>
  );
}

/** A task's status as a dot and a word. */
export function StatusDot({ status, className }: { status: AcademicTask["status"]; className?: string }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", config.dotColor)} aria-hidden />
      <span className="truncate text-muted-foreground">{config.label}</span>
    </span>
  );
}

/**
 * One task as a single line: what it is, how much effort is in, and when it
 * is due. The shared row for every list of tasks outside the Tasks ledger.
 */
export function TaskLine({
  task,
  href = `/tasks/${task.id}`,
  showEffort = true,
  trailing,
  className,
}: {
  task: AcademicTask;
  href?: string;
  showEffort?: boolean;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const completed = task.status === "Completed";
  return (
    <li className={cn("group/task relative", className)}>
      <Link
        href={href}
        className="flex min-w-0 items-center gap-3 px-(--card-spacing) py-3 transition-colors duration-150 hover-fine:bg-muted/50 focus-visible:bg-muted/50 compact:py-2"
      >
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium",
              completed && "text-muted-foreground line-through decoration-muted-foreground/40",
            )}
          >
            {task.title}
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <CategoryTag category={task.category} />
            {task.priority === "High" && !completed && (
              <span className="shrink-0 text-[0.6875rem] font-semibold uppercase tracking-wide text-deficit">
                High
              </span>
            )}
            {task.course && <span className="truncate text-xs text-muted-foreground">{task.course}</span>}
          </div>
        </div>
        {showEffort && (
          <div className="hidden w-24 shrink-0 flex-col gap-1.5 @lg/dashboard:flex">
            <span className="text-end text-xs tabular-nums text-muted-foreground">
              {completed ? "Done" : `${formatDuration(task.remainingDuration)} left`}
            </span>
            <EffortBar worked={task.actualDuration} remaining={task.remainingDuration} />
          </div>
        )}
        <DueChip deadline={task.deadline} completed={completed} className="w-20 justify-end" />
        {trailing}
      </Link>
    </li>
  );
}

/** Settings and forms: label and explanation on the left, the control on the right. */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const LabelTag = htmlFor ? "label" : "p";
  return (
    <div
      data-slot="setting-row"
      className={cn(
        "flex flex-col gap-3 py-4 first:pt-0 last:pb-0 @2xl/dashboard:flex-row @2xl/dashboard:items-center @2xl/dashboard:justify-between @2xl/dashboard:gap-8 compact:py-3",
        className,
      )}
    >
      <div className="min-w-0 @2xl/dashboard:max-w-md">
        <LabelTag {...(htmlFor ? { htmlFor } : {})} className="text-sm font-medium">
          {label}
        </LabelTag>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2 @2xl/dashboard:justify-end">{children}</div>
    </div>
  );
}

/** A short numbered flow, e.g. Connect → Review → Done. */
export function StepFlow({
  steps,
  current,
  label = "Progress",
  className,
}: {
  steps: string[];
  /** Zero-based index of the step in progress; `steps.length` once finished. */
  current: number;
  label?: string;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cn("flex items-center gap-2 text-xs", className)}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 items-center gap-2"
          >
            {index > 0 && (
              <span
                aria-hidden
                className={cn("h-px w-6 shrink-0 @lg/dashboard:w-10", done || active ? "bg-primary/50" : "bg-border")}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold tabular-nums transition-colors duration-200",
                done && "border-transparent bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" /> : index + 1}
            </span>
            <span className={cn("truncate", active ? "font-medium text-foreground" : "text-muted-foreground")}>
              {step}
              <span className="sr-only">{done ? " (done)" : active ? " (current step)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
