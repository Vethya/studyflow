"use client";

import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { formatDuration } from "@/lib/constants";
import type { OverloadWarning, RelevantUnavailablePeriod } from "@/types/schedule";
import { formatDateTime } from "@/lib/datetime";
import { useAccountTimezone } from "@/hooks/use-account-timezone";

function describePeriod(period: RelevantUnavailablePeriod, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  };
  const range = `${formatDateTime(period.startsAt, timeZone, options)} – ${formatDateTime(period.endsAt, timeZone, options)}`;
  return period.reason ? `${period.reason} (${range})` : range;
}

/**
 * The scheduler's proven Overload explanation (SPEC §10.5): for each affected
 * task, its deadline, required and available minutes, the exact shortfall, the
 * Unavailable Periods that ate into the time, and the remedies the student
 * controls. StudyFlow never applies a remedy itself, so both are links out.
 */
export function OverloadWarningList({ warnings }: { warnings: OverloadWarning[] }) {
  const timeZone = useAccountTimezone();
  return (
    <ul className="space-y-2" aria-label="Tasks that do not fit">
      {warnings.map((warning) => (
        <li key={warning.taskId}>
          <Callout
            tone="danger"
            title={
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <Link
                  href={`/tasks/${warning.taskId}`}
                  className="min-w-0 flex-1 basis-40 truncate text-foreground underline-offset-4 hover:underline"
                >
                  {warning.taskTitle}
                </Link>
                <span className="shrink-0 font-display text-base font-bold tabular-nums text-deficit">
                  {formatDuration(warning.shortfallMinutes)} short
                </span>
              </span>
            }
            actions={
              <>
                {warning.remedies.includes("extend_deadline") && (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/tasks/${warning.taskId}`} />}
                  >
                    Extend deadline
                  </Button>
                )}
                {warning.remedies.includes("add_availability") && (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/availability" />}
                  >
                    Add study time
                  </Button>
                )}
              </>
            }
          >
            <dl className="mt-0.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt>Deadline</dt>
                <dd className="font-medium text-foreground">
                  {formatDateTime(warning.deadline, timeZone, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
              <div>
                <dt>Needs</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {formatDuration(warning.requiredMinutes)}
                </dd>
              </div>
              <div>
                <dt>Free before deadline</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {formatDuration(warning.availableMinutes)}
                </dd>
              </div>
              <div>
                <dt>Shortfall</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {formatDuration(warning.shortfallMinutes)}
                </dd>
              </div>
            </dl>

            {warning.relevantUnavailablePeriods.length > 0 && (
              <div className="mt-2 flex items-start gap-1.5 text-xs">
                <CalendarOff className="mt-0.5 size-3 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p>Blocked time before this deadline:</p>
                  <ul className="mt-0.5 list-disc ps-4">
                    {warning.relevantUnavailablePeriods.map((period) => (
                      <li key={period.id}>{describePeriod(period, timeZone)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Callout>
        </li>
      ))}
    </ul>
  );
}
