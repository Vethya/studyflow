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

export const HOUR_PX = 56;
/** Short sessions stay tall enough for one line of the title. */
const MIN_SESSION_BLOCK_PX = 22;
/** The shortest hour a fitted grid will draw: a 30-minute session still shows its title on one line. */
const FIT_MIN_HOUR_PX = 44;
/** Room above the first hour line and below the last, so the edge hour labels are not clipped. */
const BODY_INSET_PX = 24;
/** Space kept under a fitted grid for the card footer (legend) and the page's bottom padding. */
const FIT_BOTTOM_RESERVE_PX = 96;
/** A fitted grid should not scroll either way, so its columns may run narrower; three-letter day names still fit. */
const FIT_COLUMN_REM = 3.75;

export interface GridColumn {
  key: string;
  /** "Mon" */
  label: string;
  /** "25" — omitted by Availability, which shows a pattern, not real dates. */
  sublabel?: string;
  /** "Oct" — shown on the agenda's date tiles. */
  month?: string;
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
  /** Full planned duration, including sessions that cross midnight. */
  durationMinutes?: number;
  /** Dimmed treatment for a session whose outcome is already recorded. */
  settled?: boolean;
  /** Marks a past session still waiting on an outcome (SPEC §12.1). */
  attention?: boolean;
  /** Optional badge label inside the block (e.g. "Proposed", "Missed", "Partly done"). */
  badge?: string;
  /** Explicit tone for proposals and recorded sessions. */
  tone?: "default" | "proposed" | "missed" | "delayed" | "completed";
  /** A category's dot colour class, drawn before a session's label. */
  dotClassName?: string;
  onSelect?: (e?: React.MouseEvent<HTMLElement>) => void;
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
  ariaLabel = "Week view",
  emptyContent,
  fit = false,
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
  /** Names the scrollable grid for screen readers. */
  ariaLabel?: string;
  emptyContent?: React.ReactNode;
  /**
   * Sizes the hours to the room left on screen, between a readable minimum
   * and the normal height, and lets the page scroll instead of the grid.
   */
  fit?: boolean;
}) {
  const hours = React.useMemo(
    () => Array.from({ length: Math.max(1, hourEnd - hourStart) }, (_, i) => hourStart + i),
    [hourStart, hourEnd],
  );

  const isEmpty = Boolean(emptyContent) && blocks.length === 0;

  // A fitted grid shares out the room left below its top edge in the page's
  // scroll area. A fixed guess cannot work because each page stacks a
  // different amount of content above its grid. Hours never get shorter than
  // FIT_MIN_HOUR_PX: past that point the grid grows and the page scrolls,
  // because squeezed hours are harder to read than a short scroll.
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [fittedHourPx, setFittedHourPx] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const body = bodyRef.current;
    const scroller = body?.closest("main");
    if (!fit || !body || !scroller) return;
    const measure = () => {
      const offset = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const room = scroller.clientHeight - offset - FIT_BOTTOM_RESERVE_PX - BODY_INSET_PX;
      setFittedHourPx(Math.min(HOUR_PX, Math.max(FIT_MIN_HOUR_PX, room / hours.length)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fit, isEmpty, hours.length]);
  const hourPx = fit && fittedHourPx !== null ? fittedHourPx : HOUR_PX;

  const template = `${isEmpty ? "" : "3.5rem "}repeat(${columns.length}, minmax(0, 1fr))`;
  const topOf = (minutes: number) => ((minutes - hourStart * 60) / 60) * hourPx;
  const bodyHeight = hours.length * hourPx;

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
      {/* Focusable so keyboard users can scroll it sideways (WCAG 2.1.1). */}
      <div
        className={cn(
          "rounded-xl focus-visible:outline-2 focus-visible:outline-ring",
          fit ? "overflow-x-auto overflow-y-hidden" : "max-h-[36rem] overflow-auto",
        )}
        tabIndex={0}
        role="region"
        aria-label={ariaLabel}
      >
        {/*
          Each column needs about 4rem before its day heading starts to
          collide; below that the grid scrolls sideways rather than crushing
          every column into an unreadable sliver. Scaling with the column
          count matters because the mobile calendar renders a single day, and
          a fixed seven-column minimum would have made that scroll too.
        */}
        <div style={{ minWidth: `${columns.length * (fit ? FIT_COLUMN_REM : 5.5) + (isEmpty ? 0 : 3.5)}rem` }}>
          {/* ── Column headers ── */}
          <div
            className="sticky top-0 z-20 grid border-b bg-card"
            style={{ gridTemplateColumns: template }}
          >
            {!isEmpty && <div className="flex items-center justify-center text-[0.625rem] text-muted-foreground">Time</div>}
            {columns.map((column) => (
              <div
                key={column.key}
                className={cn(
                  "min-w-0 border-e border-border/40 px-2 py-4 last:border-e-0",
                  column.isToday && "bg-primary/5",
                )}
              >
                {/* Day above date, stacked and centred: the two used to sit on
                    one line, which gave a seven-column week no breathing room
                    and pushed the weekday and the number into each other. */}
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      column.isToday ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {column.label}
                  </span>
                  {column.sublabel && (
                    <span
                      className={cn(
                        "flex size-9 items-center justify-center rounded-full text-xl tabular-nums font-semibold tracking-tight",
                        column.isToday
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground",
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
          {!isEmpty && <div ref={bodyRef} className="pb-3">
          <div className="grid" style={{ gridTemplateColumns: template }}>
            {/* Hour gutter. The label sits on the line it names, nudged up so it
                straddles the rule rather than floating in the cell below it. */}
            <div className="relative" style={{ height: bodyHeight + 12 }}>
              {hours.map((hour, index) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 flex justify-end pe-2"
                  style={{ top: index * hourPx + 4 }}
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
                  "relative border-e border-border/40 last:border-e-0",
                  column.isToday && "bg-primary/5",
                )}
                style={{ height: bodyHeight, marginTop: 12 }}
              >
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-border/40"
                    style={{ top: index * hourPx, height: hourPx }}
                  >
                    <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/20" />
                  </div>
                ))}

                {(byColumn.get(column.key) ?? []).map((block) => {
                  const top = topOf(block.start);
                  const isSession = block.variant === "session";
                  const height = Math.max(
                    isSession ? MIN_SESSION_BLOCK_PX : 6,
                    topOf(block.end) - top,
                  );
                  const highlighted = highlightedId === block.id;

                  const body = (
                    <>
                      {block.label && height >= 20 && (
                        <span
                          className={cn(
                            "block px-1.5 text-start",
                            // A short session centres its one line instead of
                            // pinning it to the top edge with uneven padding.
                            height < 34 ? "flex h-full items-center" : "pt-1.5",
                          )}
                        >
                          <span className="flex w-full min-w-0 items-center justify-between gap-1">
                            <span
                              className={cn(
                                "block min-w-0 text-xs font-semibold leading-snug",
                                // Two lines only when the block is tall enough
                                // for a second one to fit without clipping.
                                height >= 58 ? "line-clamp-2" : "truncate",
                              )}
                            >
                              {block.dotClassName && (
                                <span
                                  aria-hidden
                                  className={cn("me-1 inline-block size-1.5 rounded-full align-middle", block.dotClassName)}
                                />
                              )}
                              {block.label}
                            </span>
                            {block.badge && (
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center rounded px-1 py-0 text-[0.5625rem] font-medium",
                                  block.tone === "proposed" && "bg-primary/15 text-primary",
                                  block.tone === "missed" && "bg-deficit/20 text-deficit font-bold",
                                  block.tone === "delayed" && "bg-warning/25 text-warning font-bold",
                                  block.tone === "completed" && "bg-muted text-muted-foreground",
                                  (!block.tone || block.tone === "default") && "bg-muted text-muted-foreground",
                                )}
                              >
                                {block.badge}
                              </span>
                            )}
                          </span>
                          {block.meta && height >= 38 && (
                            <span className="mt-0.5 block truncate text-[0.6875rem] tracking-tight tabular-nums text-foreground">
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
                    "absolute inset-x-1 flex flex-col justify-start overflow-hidden rounded-lg border text-start transition-[background-color,border-color,box-shadow,transform] duration-150 ease-fluid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    block.onSelect && "active:scale-[0.98]",
                    isSession
                      ? cn(
                          "z-10 shadow-xs",
                          block.tone === "proposed" &&
                            "border-primary bg-card text-foreground ring-1 ring-primary/40",
                          block.tone === "missed" &&
                            "border-deficit/70 bg-deficit/10 text-foreground",
                          block.tone === "delayed" &&
                            "border-warning/80 bg-warning/15 text-foreground",
                          block.tone === "completed" &&
                            "border-border bg-muted/60 text-muted-foreground",
                          (!block.tone || block.tone === "default") && (
                            block.settled
                              ? "border-border bg-card text-muted-foreground"
                              : "border-primary/30 border-s-[3px] border-s-primary bg-primary/15 text-foreground"
                          ),
                          block.onSelect &&
                            "cursor-pointer hover:border-primary hover:bg-primary/25 hover:z-30",
                        )
                      : block.variant === "available"
                        ? cn(
                            "text-foreground",
                            highlighted
                              ? "border-surplus/70 bg-surplus/25"
                              : "border-surplus/30 bg-surplus/15",
                            block.onSelect &&
                              "cursor-pointer hover:border-surplus/70 hover:bg-surplus/25 hover:shadow-sm",
                            // After the colour classes: tailwind-merge lets a
                            // later all-sides border colour override the accent.
                            "border-s-[3px] border-s-surplus",
                          )
                        : // Blocked time is hatched as well as grey, so it stays
                          // distinguishable without relying on colour.
                          "border-border/40 bg-muted/40 [background-image:repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--color-border)_40%,transparent)_6px_7px)]",
                  );

                  if (block.onSelect) {
                    return (
                      <button
                        key={block.id}
                        type="button"
                        title={block.title}
                        // A session or window that crosses midnight can be only a few pixels
                        // tall on this day, too short to show its text.
                        aria-label={block.title}
                        onClick={block.onSelect}
                        onMouseEnter={() => onHighlight?.(block.id)}
                        onMouseLeave={() => onHighlight?.(null)}
                        onFocus={() => onHighlight?.(block.id)}
                        onBlur={() => onHighlight?.(null)}
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
                      aria-label={isSession ? block.title : undefined}
                      tabIndex={isSession ? 0 : undefined}
                      onMouseEnter={() => onHighlight?.(block.id)}
                      onMouseLeave={() => onHighlight?.(null)}
                      className={cn(
                        className,
                        isSession && "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                      )}
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
          </div>}
        </div>
      </div>
      {isEmpty && emptyContent}
    </div>
  );
}

/** The grid's key, shared by both screens so the marks mean the same thing. */
export function GridLegend({
  showDeadline = false,
  showSession = false,
  proposalStates = [],
}: {
  showDeadline?: boolean;
  showSession?: boolean;
  proposalStates?: ("proposed" | "missed" | "delayed" | "completed")[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {proposalStates.includes("proposed") && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm border-2 border-primary bg-primary/10" />
          Proposed
        </span>
      )}
      {proposalStates.includes("missed") && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm border border-deficit bg-deficit/15" />
          Missed
        </span>
      )}
      {proposalStates.includes("delayed") && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm border border-warning bg-warning/20" />
          Partly done
        </span>
      )}
      {proposalStates.includes("completed") && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm border border-border bg-muted/60" />
          Completed
        </span>
      )}
      {showSession && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm border border-primary/30 border-s-2 border-s-primary bg-primary/15" />
          Study session
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm border border-surplus/25 border-s-2 border-s-surplus bg-surplus/10" />
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
