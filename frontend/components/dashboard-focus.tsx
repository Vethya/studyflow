"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, CalendarDays, Clock3, ListChecks, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryTag } from "@/components/page-kit";
import { dayKey, formatClock, formatDate } from "@/lib/datetime";
import { formatDuration } from "@/lib/constants";
import { useAccountTimezone } from "@/hooks/use-account-timezone";
import type { StudySession } from "@/types/session";

/** "In 45 min", "Today at 14:00", "Tomorrow at 09:00" — how far away a session is. */
function startsIn(start: Date, now: Date, timeZone: string) {
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "Starting now";
  if (minutes < 60) return `In ${minutes} min`;
  const today = dayKey(now, timeZone);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000), timeZone);
  const day = dayKey(start, timeZone);
  if (day === today) return `Today at ${formatClock(start, timeZone)}`;
  if (day === tomorrow) return `Tomorrow at ${formatClock(start, timeZone)}`;
  return null;
}

/**
 * The one card that always answers "where do I start?". It names a single
 * next action — set hours, add work, review a plan, record a session, or go
 * study. The full setup checklist lives in the sidebar guide.
 */
export function DashboardFocus({ ready, hasWindows, openTasks, pendingPlan, awaitingOutcome, nextSession, onReview, onRecord, now }: {
  ready: boolean;
  hasWindows: boolean;
  openTasks: number;
  pendingPlan: boolean;
  awaitingOutcome: number;
  nextSession: StudySession | null;
  onReview: () => void;
  onRecord: () => void;
  now?: Date;
}) {
  const timeZone = useAccountTimezone();
  if (!ready) return <Skeleton className="h-36 w-full rounded-2xl" />;

  const current = now ?? new Date();
  const next = !hasWindows
    ? { title: "Start with your study hours", description: "Tell us when you’re free each week. We’ll use those hours to build a plan that fits your life.", action: "Set my study hours", href: "/availability", icon: Clock3 }
    : openTasks === 0
      ? { title: "What are you working on?", description: "Add your first task with a deadline and an estimate. You can also bring in coursework from Google.", action: "Add a task", href: "/tasks", icon: ListChecks }
      : pendingPlan
        ? { title: "Your plan is ready to review", description: "Check the proposed sessions, then accept the plan when it works for you.", action: "Review my plan", onClick: onReview, icon: CalendarDays }
        : awaitingOutcome > 0
          ? { title: "Let’s catch up on your study sessions", description: `${awaitingOutcome} ${awaitingOutcome === 1 ? "session needs" : "sessions need"} an update. Record what happened so your remaining work stays accurate.`, action: "Record what happened", onClick: onRecord, icon: CalendarClock }
          : nextSession
            ? { title: nextSession.taskTitle, description: `${formatDate(new Date(nextSession.startTime), timeZone, { weekday: "long", month: "short", day: "numeric" })} at ${formatClock(new Date(nextSession.startTime), timeZone)} · ${formatDuration(nextSession.plannedDuration)} of focused study`, action: "View my session", href: "/calendar", icon: CalendarDays }
            : { title: "Turn your tasks into a study plan", description: "Your hours and coursework are ready. Open the calendar to generate and review your study sessions.", action: "Plan my time", href: "/calendar", icon: Sparkles };
  const Icon = next.icon;
  const isSession = Boolean(nextSession && !pendingPlan && !awaitingOutcome && hasWindows && openTasks > 0);
  const countdown = isSession && nextSession ? startsIn(new Date(nextSession.startTime), current, timeZone) : null;

  return (
    <section
      aria-labelledby="dashboard-next-step"
      className="dashboard-focus frame-hatch flex flex-col overflow-hidden rounded-2xl border bg-frame p-1 shadow-xs"
    >
      <div className="flex items-center justify-between gap-3 px-3 pt-2 pb-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {isSession ? "Your next study session" : "Your next step"}
        </p>
        {countdown && (
          <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium tabular-nums shadow-xs">
            {countdown}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs @2xl/dashboard:flex-row @2xl/dashboard:items-center @2xl/dashboard:justify-between @2xl/dashboard:px-5">
        <div className="min-w-0">
          <h2
            id="dashboard-next-step"
            className="wrap-break-word text-lg leading-snug font-semibold tracking-tight @2xl/dashboard:text-xl"
          >
            {next.title}
          </h2>
          {isSession && nextSession && (
            <div className="mt-1.5">
              <CategoryTag category={nextSession.category} />
            </div>
          )}
          <p className="mt-1 line-clamp-2 max-w-xl text-sm leading-6 text-muted-foreground @4xl/dashboard:[@media(max-height:760px)]:hidden">{next.description}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {next.href ? (
            <Button nativeButton={false} role="link" render={<Link href={next.href} />} className="w-full @lg/dashboard:w-auto">{next.action}<ArrowRight className="size-4" aria-hidden /></Button>
          ) : (
            <Button onClick={next.onClick} className="w-full @lg/dashboard:w-auto">{next.action}<ArrowRight className="size-4" aria-hidden /></Button>
          )}
        </div>
      </div>

    </section>
  );
}
