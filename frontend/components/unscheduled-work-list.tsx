"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { formatDuration } from "@/lib/constants";
import type { UnscheduledWork } from "@/types/schedule";

/**
 * Work with no valid session (SPEC §5.4).
 *
 * Each entry explains *why* it could not be placed and offers the two remedies
 * the student controls (SPEC §10.5, §17.3). StudyFlow never changes a deadline
 * or adds availability on the student's behalf, so both are links out rather
 * than one-click fixes.
 */
export function UnscheduledWorkList({ items }: { items: UnscheduledWork[] }) {
  if (items.length === 0) {
    return (
      <Callout tone="success" title="Everything has a slot">
        All of your remaining work is scheduled.
      </Callout>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.taskId} className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Link
              href={`/tasks/${item.taskId}`}
              className="min-w-0 flex-1 basis-40 truncate text-sm font-medium underline-offset-4 hover:underline"
            >
              {item.taskTitle}
            </Link>
            <span className="shrink-0 text-sm font-medium tabular-nums text-deficit">
              {formatDuration(item.remainingMinutes)} unplaced
            </span>
          </div>

          <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/tasks/${item.taskId}`} />}
            >
              Change deadline
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/availability" />}
            >
              Add study time
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
