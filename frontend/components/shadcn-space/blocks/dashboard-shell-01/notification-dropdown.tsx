"use client";

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import { AlertTriangle, BellRing, CalendarDays, CalendarClock, CheckCircle2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApi } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import { scheduling, tasks as tasksApi } from "@/lib/api";
import { buildReminders, markRemindersSeen, noSeenReminders, seenReminders, subscribeToSeenReminders, type ReminderKind } from "@/lib/reminders";
import { labelSessions } from "@/lib/session-labels";
import { SWR_KEYS } from "@/lib/swr-keys";
import { cn } from "@/lib/utils";

const VISIBLE = 5;

const KIND_STYLE: Record<ReminderKind, { icon: React.ElementType; tile: string }> = {
  plan: { icon: CalendarDays, tile: "bg-primary/10 text-primary" },
  outcome: { icon: CalendarClock, tile: "bg-warning/15 text-warning" },
  overdue: { icon: AlertTriangle, tile: "bg-deficit/10 text-deficit" },
};

export default function NotificationDropdown() {
  const loadRevision = useCallback((signal: AbortSignal) => scheduling.getPendingRevision(signal), []);
  const loadTasks = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const revision = useApi(SWR_KEYS.pendingRevision, loadRevision);
  const tasks = useApi(SWR_KEYS.tasks, loadTasks);
  const loadSchedule = useCallback((signal: AbortSignal) => scheduling.getActiveSchedule(signal), []);
  const schedule = useApi(SWR_KEYS.activeSchedule, loadSchedule);
  const now = useNow();
  const seen = useSyncExternalStore(subscribeToSeenReminders, seenReminders, noSeenReminders);
  // What was already seen when the menu opened, so new items stay marked while it is open.
  const [seenAtOpen, setSeenAtOpen] = useState<ReadonlySet<string>>(seen);

  const isLoading = revision.isLoading || tasks.isLoading || schedule.isLoading;
  const error = revision.error ?? tasks.error ?? schedule.error;
  const reminders = isLoading || error ? [] : buildReminders({
    revisionId: revision.data?.id ?? null,
    sessions: labelSessions(schedule.data?.sessions ?? [], tasks.data),
    tasks: tasks.data ?? [],
    now: now.getTime(),
  });
  const unseen = reminders.filter((reminder) => !seen.has(reminder.id)).length;
  const label = unseen > 0 ? `Study reminders, ${unseen} new` : "Study reminders";

  // Opening or closing both count as having looked at everything listed.
  const onOpenChange = () => {
    setSeenAtOpen(seen);
    if (unseen > 0) markRemindersSeen(reminders.map((reminder) => reminder.id));
  };

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={label} title={label} data-tour="reminders" className="relative rounded-lg text-muted-foreground hover:text-foreground" />}>
        <BellRing className="size-[1.125rem]" />
        {unseen > 0 && <span data-testid="reminder-dot" className="absolute right-2 top-2 size-1.5 rounded-full bg-deficit ring-2 ring-background" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-80 max-w-[calc(100vw-1.5rem)] rounded-xl p-0">
        <div className="flex items-center justify-between gap-2 px-3.5 py-3">
          <p className="text-sm font-semibold">Reminders</p>
          {reminders.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-muted-foreground">{reminders.length}</span>}
        </div>
        <DropdownMenuSeparator className="my-0" />
        {isLoading ? <p className="px-3.5 py-4 text-sm text-muted-foreground">Checking your plan…</p> : error ? <p className="px-3.5 py-4 text-sm text-muted-foreground">Could not check your plan. Open the calendar to try again.</p> : reminders.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-7 text-center">
            <CheckCircle2 className="size-6 text-surplus" aria-hidden />
            <p className="text-sm font-medium">You are all caught up.</p>
            <p className="text-xs text-muted-foreground">Overdue tasks, sessions to record and plan changes show up here.</p>
          </div>
        ) : (
          <div className="max-h-[22rem] overflow-y-auto p-1.5">
            {reminders.slice(0, VISIBLE).map((reminder) => {
              const { icon: Icon, tile } = KIND_STYLE[reminder.kind];
              const isNew = !seenAtOpen.has(reminder.id);
              return (
                <DropdownMenuItem key={reminder.id} render={<Link href={reminder.href} />} data-new={isNew || undefined} className="items-start gap-3 rounded-lg p-2.5">
                  <span className={cn("mt-0.5 rounded-lg p-1.5", tile)}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[0.8125rem] leading-snug font-medium">{reminder.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{reminder.detail}</span>
                  </span>
                  {isNew && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
                </DropdownMenuItem>
              );
            })}
            {reminders.length > VISIBLE && (
              <p className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">And {reminders.length - VISIBLE} more.</p>
            )}
          </div>
        )}
        <DropdownMenuSeparator className="my-0" />
        <div className="flex gap-1 p-1.5">
          <DropdownMenuItem render={<Link href="/calendar" />} className="flex-1 justify-center rounded-lg py-1.5 text-xs font-medium">Open calendar</DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/tasks?status=overdue" />} className="flex-1 justify-center rounded-lg py-1.5 text-xs font-medium">Overdue tasks</DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
