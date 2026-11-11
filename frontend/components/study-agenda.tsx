"use client";

import Link from "next/link";
import { CalendarDays, ChevronRight, Clock3 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/page-kit";
import { formatClock } from "@/lib/datetime";
import { formatDuration } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { GridBlock, GridColumn } from "@/components/week-grid";
import type { AcademicTask } from "@/types/task";

export function StudyAgenda({ columns, blocks, deadlines, timeZone, emptyAction }: {
  columns: GridColumn[];
  blocks: GridBlock[];
  deadlines: Map<string, AcademicTask[]>;
  timeZone: string;
  emptyAction: React.ReactNode;
}) {
  const hasEvents = columns.some((day) => blocks.some((block) => block.columnKey === day.key && block.variant === "session") || (deadlines.get(day.key)?.length ?? 0) > 0);
  return <div role="region" aria-label="Study agenda">
    {!hasEvents ? <EmptyState icon={CalendarDays} title="No sessions planned" action={emptyAction}>Your study sessions and deadlines will appear here. Build a plan when your tasks and study hours are ready.</EmptyState> : (
      <div className="divide-y">
        {columns.map((day) => {
          const sessions = blocks.filter((block) => block.columnKey === day.key && block.variant === "session").sort((a, b) => a.start - b.start);
          const due = deadlines.get(day.key) ?? [];
          const free = blocks.filter((block) => block.columnKey === day.key && block.variant === "available").reduce((sum, block) => sum + block.end - block.start, 0);
          // Red marks the days that need attention: today, and any day with a deadline.
          const flagged = day.isToday || due.length > 0;
          return <section key={day.key} aria-label={`${day.label} ${day.sublabel ?? ""}`} className="grid gap-4 p-5 @2xl/dashboard:grid-cols-[5rem_minmax(0,1fr)]">
            <div className="flex items-center gap-3 @2xl/dashboard:w-14 @2xl/dashboard:flex-col @2xl/dashboard:gap-1.5">
              <span
                data-flagged={flagged || undefined}
                className={cn(
                  "flex size-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border bg-card shadow-xs",
                  flagged ? "border-deficit/70" : "border-border",
                )}
              >
                <span className={cn("text-[0.625rem] leading-none font-bold tracking-wider uppercase", flagged ? "text-deficit" : "text-muted-foreground")}>{day.month}</span>
                <span className="text-xl leading-none font-semibold tracking-tight tabular-nums">{day.sublabel}</span>
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {day.label}
                {day.isToday && <span className="font-medium text-deficit"> · Today</span>}
              </span>
            </div>
            <div className="min-w-0 space-y-2">
              {due.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-3 rounded-lg border border-deficit/20 bg-deficit-soft px-3 py-3 focus-visible:outline-2 focus-visible:outline-ring">
                <CalendarDays className="size-4 shrink-0 text-deficit" />
                <span className="min-w-0 flex-1 text-sm font-medium">{task.title}<span className="mt-1 block text-xs font-normal text-muted-foreground">Due {formatClock(task.deadline, timeZone)}</span></span>
                <Badge variant="outline">Deadline</Badge>
              </Link>)}
              {sessions.map((session) => <Button key={session.id} variant="ghost" onClick={session.onSelect} aria-label={session.title} className={cn("h-auto w-full justify-start gap-3 whitespace-normal rounded-lg border border-primary/20 border-s-[3px] border-s-primary bg-primary/5 p-3 text-start hover-fine:bg-primary/10 compact:p-2", session.settled && "border-border bg-muted/30", session.attention && "border-s-deficit")}>
                <Clock3 className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-sm font-semibold">{session.dotClassName && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", session.dotClassName)} />}{session.label}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{session.meta} · {formatDuration(session.durationMinutes ?? Math.max(0, session.end - session.start))}</span></span>
                {session.attention && <Badge variant="outline">Record outcome</Badge>}
                {session.settled && <Badge variant="secondary">Recorded</Badge>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Button>)}
              {sessions.length === 0 && due.length === 0 && <p className="py-2 text-sm text-muted-foreground">No sessions or deadlines</p>}
              {free > 0 && <p className="pt-1 text-xs text-surplus">{formatDuration(free)} free to study</p>}
            </div>
          </section>;
        })}
      </div>
    )}
  </div>;
}
