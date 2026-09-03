"use client";

import * as React from "react";
import { formatHour } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * The one week grid in the product.
 *
 * Calendar and Availability each used to draw their own: different hour label
 * formats (`08` vs `7am`), different cell borders, different greens, one built
 * from absolutely-positioned blocks and the other from 30-minute half-cells.
 * Two screens showing the same student the same hours in two visual languages.
 *
 * This is that grid, once. Callers supply columns and blocks; the grid owns
 * hour labelling, the hatch pattern for blocked time, the "now" rule, and the
 * horizontal scroll behaviour that keeps it usable at 360px.
 */

export const HOUR_PX = 44;

export interface GridColumn {
  key: string;
  /** "Mon" */
  label: string;
  /** "25" — omitted by Availability, which shows a pattern, not real dates. */
  sublabel?: string;
  isToday?: boolean;
}

export interface GridBlock {
  id: string;
  columnKey: string;
  /** Minutes since midnight. */
  start: number;
  end: number;
  /**
   * `available` and `blocked` are background capacity; `session` is scheduled
   * work and paints on top of both, because a session always sits inside an
   * availability window and would otherwise be hidden by it.
   */
  variant: "available" | "blocked" | "session";
  title?: string;
  /** Shown inside the block when there is room. `session` only. */
  label?: string;
  /** Secondary line under the label — the session's time. */
  meta?: string;
  /** Dimmed treatment for a session whose outcome is already recorded. */
  settled?: boolean;
  /** Marks a past session still waiting on an outcome (SPEC §12.1). */
  attention?: boolean;
  onSelect?: () => void;
}

export function WeekGrid({
  columns,
  blocks,
  hourStart,
  hourEnd,
  now,
  renderLane,
  highlightedId,
  onHighlight,
  className,
}: {
  columns: GridColumn[];
  blocks: GridBlock[];
  hourStart: number;
  hourEnd: number;
  /** Draws the current-time rule. */
  now?: { columnKey: string; minutes: number };
  /** Optional row between the header and the grid — Calendar puts deadlines here. */
  renderLane?: (column: GridColumn) => React.ReactNode;
  highlightedId?: string | null;
  onHighlight?: (id: string | null) => void;
  className?: string;
}) {
  const hours = React.useMemo(
    () => Array.from({ length: Math.max(1, hourEnd - hourStart) }, (_, i) => hourStart + i),
    [hourStart, hourEnd],
  );

  const template = `2.75rem repeat(${columns.length}, minmax(0, 1fr))`;
  const topOf = (minutes: number) => ((minutes - hourStart * 60) / 60) * HOUR_PX;
  const bodyHeight = hours.length * HOUR_PX;

  const byColumn = React.useMemo(() => {
    const map = new Map<string, GridBlock[]>();
    for (const block of blocks) {
      const bucket = map.get(block.columnKey);
      if (bucket) bucket.push(block);
      else map.set(block.columnKey, [block]);
    }
    return map;
  }, [blocks]);

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      {/* One scroll container for header and body together, so the columns
          cannot drift out of alignment when the grid is scrolled sideways. */}
      <div className="overflow-x-auto">
        {/*
          Each column needs about 4rem before its day heading starts to
          collide; below that the grid scrolls sideways rather than crushing
          every column into an unreadable sliver. Scaling with the column
          count matters because the mobile calendar renders a single day, and
          a fixed seven-column minimum would have made that scroll too.
        */}
        <div style={{ minWidth: `${columns.length * 4 + 2.75}rem` }}>
          {/* ── Column headers ── */}
          <div
            className="sticky top-0 z-20 grid border-b bg-card"
            style={{ gridTemplateColumns: template }}
          >
            <div className="border-e" />
            {columns.map((column) => (
              <div
                key={column.key}
                className={cn(
                  "min-w-0 border-e px-1.5 py-2.5 last:border-e-0",
                  column.isToday && "bg-muted/40",
                )}
              >
                {/* Day above date, stacked and centred: the two used to sit on
                    one line, which gave a seven-column week no breathing room
                    and pushed the weekday and the number into each other. */}
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className={cn(
                      "text-[0.625rem] font-semibold uppercase tracking-wider",
                      column.isToday ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {column.label}
                  </span>
                  {column.sublabel && (
                    <span
                      className={cn(
                        "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-sm tabular-nums",
                        column.isToday
                          ? "bg-foreground font-semibold text-background"
                          : "font-medium text-foreground",
                      )}
                    >
                      {column.sublabel}
                    </span>
                  )}
                </div>
                {renderLane && <div className="mt-2 space-y-1">{renderLane(column)}</div>}
              </div>
            ))}
          </div>

          {/* ── Hour body ── */}
          <div className="grid" style={{ gridTemplateColumns: template }}>
            {/* Hour gutter. The label sits on the line it names, nudged up so it
                straddles the rule rather than floating in the cell below it. */}
            <div className="relative border-e" style={{ height: bodyHeight }}>
              {hours.map((hour, index) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 flex justify-end pe-2"
                  style={{ top: index * HOUR_PX - 6 }}
                >
                  <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                    {formatHour(hour)}
                  </span>
                </div>
              ))}
            </div>

            {columns.map((column) => (
              <div
                key={column.key}
                className={cn(
                  "relative border-e last:border-e-0",
                  column.isToday && "bg-muted/40",
                )}
                style={{ height: bodyHeight }}
              >
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    className={cn(
                      "absolute inset-x-0 border-b",
                      index === 0 ? "border-transparent" : "border-border/50",
                    )}
                    style={{ top: index * HOUR_PX, height: HOUR_PX }}
                  />
                ))}

                {(byColumn.get(column.key) ?? []).map((block) => {
                  const top = topOf(block.start);
                  const height = Math.max(6, topOf(block.end) - top);
                  const highlighted = highlightedId === block.id;
                  const isSession = block.variant === "session";

                  const body = (
                    <>
                      {block.label && height >= 24 && (
                        <span className="block px-1.5 pt-1 text-start">
                          <span
                            className={cn(
                              "block text-[0.6875rem] font-medium leading-tight",
                              // Two lines only when the block is tall enough
                              // for a second one to fit without clipping.
                              height >= 58 ? "line-clamp-2" : "truncate",
                            )}
                          >
                            {block.label}
                          </span>
                          {block.meta && height >= 38 && (
                            <span className="mt-0.5 block truncate text-[0.625rem] tabular-nums text-muted-foreground">
                              {block.meta}
                            </span>
                          )}
                        </span>
                      )}
                      {block.attention && (
                        <span
                          className="absolute end-1 top-1 size-1.5 rounded-full bg-deficit"
                          aria-hidden
                        />
                      )}
                    </>
                  );

                  const className = cn(
                    "absolute inset-x-1 overflow-hidden rounded-md border transition-colors",
                    isSession
                      ? cn(
                          "z-10 bg-card shadow-sm",
                          block.settled
                            ? "border-border text-muted-foreground"
                            : "border-foreground/70",
                          block.onSelect &&
                            "cursor-pointer hover:border-foreground hover:bg-muted",
                        )
                      : block.variant === "available"
                        ? highlighted
                          ? "border-surplus bg-surplus/35"
                          : "border-surplus/40 bg-surplus-soft"
                        : // Blocked time is hatched as well as grey, so it stays
                          // distinguishable without relying on colour.
                          "border-border bg-muted [background-image:repeating-linear-gradient(135deg,var(--color-border)_0_4px,transparent_4px_8px)]",
                  );

                  if (isSession && block.onSelect) {
                    return (
                      <button
                        key={block.id}
                        type="button"
                        title={block.title}
                        onClick={block.onSelect}
                        className={className}
                        style={{ top, height }}
                      >
                        {body}
                      </button>
                    );
                  }

                  return (
                    <div
                      key={block.id}
                      title={block.title}
                      onMouseEnter={() => onHighlight?.(block.id)}
                      onMouseLeave={() => onHighlight?.(null)}
                      className={className}
                      style={{ top, height }}
                    >
                      {body}
                    </div>
                  );
                })}

                {now && now.columnKey === column.key && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: topOf(now.minutes) }}
                    aria-hidden
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-deficit" />
                    <span className="h-px flex-1 bg-deficit" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The grid's key, shared by both screens so the marks mean the same thing. */
export function GridLegend({
  showDeadline = false,
  showSession = false,
}: {
  showDeadline?: boolean;
  showSession?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {showSession && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm border border-foreground/70 bg-card" />
          Study session
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm border border-surplus/40 bg-surplus-soft" />
        Free to study
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm border border-border bg-muted [background-image:repeating-linear-gradient(135deg,var(--color-border)_0_4px,transparent_4px_8px)]" />
        Blocked
      </span>
      {showDeadline && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 rounded-full bg-deficit" />
          Deadline
        </span>
      )}
    </div>
  );
}
