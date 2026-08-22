"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, CalendarOff, RefreshCw, Clock4, Info } from "lucide-react";
import { mockAvailability, mockUnavailablePeriods, DAY_NAMES } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

// Build a 15-min grid from 7:00 to 22:00 = 60 slots
const HOUR_START = 7;
const HOUR_END = 22;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

function timeToSlot(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h - HOUR_START) * 2 + (m >= 30 ? 1 : 0); // 30-min slots
}

const TOTAL_SLOTS = (HOUR_END - HOUR_START) * 2;

// Map dayOfWeek (0=Sun) to column index Mon–Sun = 0–6
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Reorder to Mon–Sun for display
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon=1 … Sun=0

export default function AvailabilityPage() {
  const [hoveredWindow, setHoveredWindow] = useState<string | null>(null);

  // Build a lookup: dayOfWeek -> array of {startSlot, endSlot, id}
  const avMap: Record<number, { id: string; startSlot: number; endSlot: number }[]> = {};
  for (const w of mockAvailability) {
    if (!avMap[w.dayOfWeek]) avMap[w.dayOfWeek] = [];
    avMap[w.dayOfWeek].push({
      id: w.id,
      startSlot: timeToSlot(w.startTime),
      endSlot: timeToSlot(w.endTime),
    });
  }

  const sortedAvail = [...mockAvailability].sort((a, b) =>
    a.dayOfWeek !== b.dayOfWeek ? a.dayOfWeek - b.dayOfWeek : a.startTime.localeCompare(b.startTime)
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── Header ─────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Availability</h1>
          <p className="text-sm text-muted-foreground">
            Set your recurring study windows — the engine schedules only within these times
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <CalendarOff className="mr-1.5 h-4 w-4" />
            Add Exception
          </Button>
          <Button size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            Add Window
          </Button>
        </div>
      </div>

      {/* ── Info banner ─────────────────────────── */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
        <span className="flex-1">
          Editing windows may invalidate already-scheduled sessions.
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs bg-white border-blue-200 text-blue-700 hover:bg-blue-50 shrink-0"
        >
          <RefreshCw className="mr-1.5 h-3 w-3" />
          Regenerate
        </Button>
      </div>

      {/* ── Main content ───────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">

        {/* Visual time grid */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Weekly Schedule</CardTitle>
            <CardDescription>
              Green blocks show when you're available to study
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-4">
            <div className="overflow-x-auto">
              <div
                className="grid min-w-[480px]"
                style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}
              >
                {/* Day headers */}
                <div className="border-b" />
                {DISPLAY_DAYS.map((dayIdx) => (
                  <div
                    key={dayIdx}
                    className="border-b border-l py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                  >
                    {DAY_SHORT[dayIdx]}
                  </div>
                ))}

                {/* Time rows — 30-min slots */}
                {HOURS.map((hour) => (
                  <div key={hour} className="contents">
                    {/* Hour label */}
                    <div className="relative">
                      <span className="absolute -top-2 right-2 text-[10px] text-muted-foreground tabular-nums">
                        {hour % 12 === 0 ? 12 : hour % 12}
                        {hour < 12 ? "am" : "pm"}
                      </span>
                      <div className="h-6 border-b border-muted/40" />
                      <div className="h-6 border-b border-muted/20" />
                    </div>

                    {/* Each day cell — top half-hour */}
                    {DISPLAY_DAYS.map((dayIdx) => {
                      const slotTop = (hour - HOUR_START) * 2;
                      const slotBot = slotTop + 1;
                      const windowsTop = (avMap[dayIdx] || []).filter(
                        (w) => slotTop >= w.startSlot && slotTop < w.endSlot
                      );
                      const windowsBot = (avMap[dayIdx] || []).filter(
                        (w) => slotBot >= w.startSlot && slotBot < w.endSlot
                      );
                      return (
                        <div key={`${dayIdx}-${hour}`} className="border-l">
                          {/* Top half */}
                          <div
                            className={cn(
                              "h-6 border-b border-muted/40 transition-colors",
                              windowsTop.length > 0
                                ? hoveredWindow && windowsTop.some(w => w.id === hoveredWindow)
                                  ? "bg-emerald-400"
                                  : "bg-emerald-200"
                                : "hover:bg-muted/50"
                            )}
                            onMouseEnter={() => windowsTop[0] && setHoveredWindow(windowsTop[0].id)}
                            onMouseLeave={() => setHoveredWindow(null)}
                          />
                          {/* Bottom half */}
                          <div
                            className={cn(
                              "h-6 border-b border-muted/20 transition-colors",
                              windowsBot.length > 0
                                ? hoveredWindow && windowsBot.some(w => w.id === hoveredWindow)
                                  ? "bg-emerald-400"
                                  : "bg-emerald-200"
                                : "hover:bg-muted/50"
                            )}
                            onMouseEnter={() => windowsBot[0] && setHoveredWindow(windowsBot[0].id)}
                            onMouseLeave={() => setHoveredWindow(null)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 px-4 pt-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="h-3 w-5 rounded-sm bg-emerald-200" />
                Available
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="h-3 w-5 rounded-sm bg-muted" />
                Unavailable
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="flex flex-col gap-4">

          {/* Windows list */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Windows</CardTitle>
                <span className="text-xs text-muted-foreground">{mockAvailability.length} total</span>
              </div>
              <CardDescription>Hover a row to highlight it on the grid</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0 p-0">
              {DAY_NAMES.map((dayName, dayIdx) => {
                const windows = sortedAvail.filter((a) => a.dayOfWeek === dayIdx);
                if (windows.length === 0) return null;
                return (
                  <div key={dayIdx}>
                    <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-t first:border-t-0">
                      {dayName}
                    </div>
                    {windows.map((w) => (
                      <div
                        key={w.id}
                        className={cn(
                          "flex items-center justify-between px-4 py-2.5 border-b last:border-0 transition-colors cursor-default",
                          hoveredWindow === w.id ? "bg-emerald-50" : "hover:bg-muted/40"
                        )}
                        onMouseEnter={() => setHoveredWindow(w.id)}
                        onMouseLeave={() => setHoveredWindow(null)}
                      >
                        <div className="flex items-center gap-2">
                          <Clock4 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span className="text-sm tabular-nums">
                            {w.startTime} – {w.endTime}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Unavailable periods */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Exceptions</CardTitle>
              <CardDescription>One-off periods where you're not available</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {mockUnavailablePeriods.map((period) => {
                const start = new Date(period.startDate);
                const end = new Date(period.endDate);
                const sameDay = start.toDateString() === end.toDateString();
                return (
                  <div
                    key={period.id}
                    className="flex items-start justify-between rounded-lg border bg-muted/30 p-3 gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background border">
                        <CalendarOff className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{period.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {sameDay
                            ? start.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                            : `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        </div>
                        {period.reason && (
                          <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                            {period.reason}
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
