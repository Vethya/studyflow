"use client";

import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { formatDuration } from "@/lib/constants";
import { describeDeadline } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { TaskFeasibility } from "@/lib/capacity";

/**
 * An overload warning: this task needs more hours than remain before it is due.
 *
 * The previous version filled the whole card with solid `deficit-soft` and laid
 * the four figures out as a monospace definition list — Deadline / Required /
 * Available / Shortfall. Three of those stacked down the dashboard read as an
 * alarm going off, and the figures had to be mentally subtracted to find the
 * one number that matters.
 *
 * So: the shortfall is the headline and everything else supports it. The bar
 * shows at a glance how much of the required time actually exists, which is the
 * comparison the definition list was asking the reader to do themselves.
 */
export function ShortfallCard({ item }: { item: TaskFeasibility }) {
  const { task, requiredMinutes, availableMinutes, shortfallMinutes, relevantPeriods } = item;
  const due = describeDeadline(task.deadline);

  // What share of the required time the student actually has. Guarded against a
  // zero requirement, which would otherwise divide to NaN and blank the bar.
  const covered =
    requiredMinutes > 0 ? Math.min(1, Math.max(0, availableMinutes / requiredMinutes)) : 0;

  return (
    <Callout
      tone="danger"
      title={
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <Link
            href={`/tasks/${task.id}`}
            className="min-w-0 flex-1 basis-40 truncate text-foreground underline-offset-4 hover:underline"
          >
            {task.title}
          </Link>
          <span className="shrink-0 font-display text-base font-bold tabular-nums text-deficit">
            {formatDuration(shortfallMinutes)} short
          </span>
        </span>
      }
      actions={
        // The student picks the remedy; StudyFlow never applies one itself.
        <>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/tasks/${task.id}`} />}>
            Extend deadline
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/availability" />}>
            Add study time
          </Button>
        </>
      }
    >
      <div
        className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-deficit/20"
        role="img"
        aria-label={`${formatDuration(availableMinutes)} free of the ${formatDuration(requiredMinutes)} needed`}
      >
        <div
          className="h-full rounded-full bg-deficit transition-[width]"
          style={{ width: `${Math.max(covered * 100, covered > 0 ? 3 : 0)}%` }}
        />
      </div>

      <p className="mt-2 text-xs">
        Needs <span className="font-medium text-foreground">{formatDuration(requiredMinutes)}</span>
        {" · only "}
        <span className="font-medium text-foreground">{formatDuration(availableMinutes)}</span>
        {" free before "}
        <span className={cn("font-medium", due.urgent ? "text-deficit" : "text-foreground")}>
          {new Date(task.deadline).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })}
        </span>
      </p>

      {relevantPeriods.length > 0 && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs">
          <CalendarOff className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="min-w-0">
            Blocked by {relevantPeriods.map((period) => period.title).join(", ")}
          </span>
        </p>
      )}
    </Callout>
  );
}
