"use client";

import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/constants";

interface CapacityBarProps {
  /** Study minutes free in the period. */
  available: number;
  /** Planned minutes owed in the same period. */
  committed: number;
  className?: string;
}

/**
 * The one figure this product exists to show: how the work you owe compares to
 * the time you have.
 *
 * The track is the time available. Committed time fills it — and when it
 * exceeds it, the overflow is drawn *past the end of the track* rather than
 * clamped at full. A bar pinned at 100% reads as "done"; a bar breaking its
 * own container reads as "this does not fit", which is the point.
 */
export function CapacityBar({ available, committed, className }: CapacityBarProps) {
  const hasCapacity = available > 0;
  const overcommitted = committed > available;

  // The track occupies the first 72% of the width, leaving room for overflow
  // to be drawn at the same scale rather than compressed into a sliver.
  const TRACK = 72;
  const scale = hasCapacity ? TRACK / available : 0;

  const filled = hasCapacity ? Math.min(committed, available) * scale : 0;
  const overflowRaw = hasCapacity ? Math.max(0, committed - available) * scale : TRACK;
  const overflow = Math.min(overflowRaw, 100 - TRACK);
  const overflowClipped = overflowRaw > 100 - TRACK;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative h-9">
        {/* Track: the time you actually have */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-md border border-border bg-muted"
          style={{ width: `${TRACK}%` }}
        />

        {/* Committed time inside capacity */}
        {filled > 0 && (
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-l-md transition-[width] duration-500",
              overcommitted ? "bg-deficit/20" : "bg-surplus/25",
            )}
            style={{
              width: `${filled}%`,
              // Diagonal hatching when the work does not fit, so the state is
              // legible without relying on hue (SPEC §19.5).
              backgroundImage: overcommitted
                ? "repeating-linear-gradient(135deg, color-mix(in oklch, var(--deficit) 22%, transparent) 0 5px, transparent 5px 10px)"
                : undefined,
            }}
          />
        )}

        {/* The capacity edge. Everything right of this line does not fit. */}
        <div
          className="absolute inset-y-0 w-px bg-foreground"
          style={{ left: `${TRACK}%` }}
          aria-hidden
        />

        {/* Overflow: drawn past the edge, at the same scale */}
        {overflow > 0 && (
          <div
            className={cn(
              "absolute inset-y-1 bg-deficit transition-[width] duration-500",
              overflowClipped ? "rounded-r-none" : "rounded-r-md",
            )}
            style={{ left: `${TRACK}%`, width: `${overflow}%` }}
          >
            {/* Torn edge when the overflow itself runs off the component */}
            {overflowClipped && (
              <div
                className="absolute inset-y-0 right-0 w-2 bg-deficit"
                style={{
                  maskImage:
                    "repeating-linear-gradient(180deg, #000 0 4px, transparent 4px 8px)",
                  WebkitMaskImage:
                    "repeating-linear-gradient(180deg, #000 0 4px, transparent 4px 8px)",
                }}
                aria-hidden
              />
            )}
          </div>
        )}
      </div>

      {/* Legend. The numbers are the message, so they are set in the data face. */}
      <div className="flex items-baseline justify-between gap-4 font-mono text-xs">
        <span className="text-muted-foreground">
          <span className="text-foreground">{formatDuration(committed)}</span> of work
        </span>
        <span className="text-muted-foreground">
          <span className="text-foreground">{formatDuration(available)}</span> free
        </span>
      </div>
    </div>
  );
}
