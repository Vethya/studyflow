"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import { mockSessions, mockTasks, mockAvailability } from "@/lib/mock-data";
import { formatDuration, CATEGORY_CONFIG } from "@/lib/constants";

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7AM to 9PM
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeekDates(offset: number = 0) {
  const now = new Date();
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  startOfWeek.setDate(startOfWeek.getDate() + diff + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });
}

// Category color mapping for session blocks
const categoryColors: Record<string, string> = {
  Assignment: "bg-indigo-100 border-l-indigo-500 text-indigo-900",
  Reading: "bg-teal-100 border-l-teal-500 text-teal-900",
  "Exam Preparation": "bg-rose-100 border-l-rose-500 text-rose-900",
  Project: "bg-amber-100 border-l-amber-500 text-amber-900",
  "Research/Writing": "bg-sky-100 border-l-sky-500 text-sky-900",
  Other: "bg-zinc-100 border-l-zinc-500 text-zinc-900",
};

export default function CalendarPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDates = getWeekDates(weekOffset);
  const today = new Date();

  // Availability hours for shading
  const availHours = new Set<string>();
  mockAvailability.forEach((a) => {
    const startH = parseInt(a.startTime.split(":")[0]);
    const endH = parseInt(a.endTime.split(":")[0]);
    for (let h = startH; h < endH; h++) {
      availHours.add(`${a.dayOfWeek}-${h}`);
    }
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Your weekly study schedule
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekOffset((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium" onClick={() => setWeekOffset(0)}>
              Today
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekOffset((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-sm font-medium ml-2">
            {weekDates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {weekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <div className="ml-auto">
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add task
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="week">
        <TabsList>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
        </TabsList>

        <TabsContent value="week" className="mt-4">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {/* Week grid */}
              <div className="min-w-[800px]">
                {/* Day headers */}
                <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b">
                  <div className="p-2" /> {/* time gutter spacer */}
                  {weekDates.map((date, i) => {
                    const isToday = date.toDateString() === today.toDateString();
                    return (
                      <div
                        key={i}
                        className={`p-2 text-center border-l ${isToday ? "bg-primary/5" : ""}`}
                      >
                        <div className="text-xs text-muted-foreground font-medium">{DAY_LABELS[i]}</div>
                        <div className={`text-lg font-semibold mt-0.5 ${isToday ? "bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center mx-auto" : ""}`}>
                          {date.getDate()}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Hour rows */}
                {HOURS.map((hour) => (
                  <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] min-h-[60px]">
                    {/* Time gutter */}
                    <div className="p-1 pr-2 text-right text-[11px] text-muted-foreground border-r">
                      {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                    </div>
                    {/* Day cells */}
                    {weekDates.map((date, dayIdx) => {
                      const dayOfWeek = date.getDay();
                      const isAvail = availHours.has(`${dayOfWeek}-${hour}`);
                      const isToday = date.toDateString() === today.toDateString();
                      const dateSessions = mockSessions.filter((s) => {
                        const sDate = new Date(s.startTime);
                        return sDate.toDateString() === date.toDateString() && sDate.getHours() === hour;
                      });

                      return (
                        <div
                          key={dayIdx}
                          className={`border-l border-t relative min-h-[60px] ${
                            !isAvail ? "bg-muted/30" : ""
                          } ${isToday ? "bg-primary/[0.02]" : ""}`}
                        >
                          {dateSessions.map((session) => {
                            const colors = categoryColors[session.category] || categoryColors.Other;
                            return (
                              <div
                                key={session.id}
                                className={`absolute inset-x-1 top-1 rounded-md border-l-[3px] p-1.5 text-xs cursor-pointer hover:shadow-md transition-shadow ${colors}`}
                                style={{ minHeight: `${Math.max(session.plannedDuration - 5, 20)}px` }}
                              >
                                <div className="font-medium truncate">{session.taskTitle}</div>
                                <div className="opacity-70 text-[10px] mt-0.5">
                                  {new Date(session.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  {" – "}
                                  {new Date(session.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agenda" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming Sessions</CardTitle>
              <CardDescription>Your study sessions in chronological order</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {["Today", "Tomorrow", "Day 3", "Day 4", "Day 5"].map((label, idx) => (
                  <div key={label}>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      {label}
                      {idx === 0 && <Badge variant="secondary" className="text-[10px]">Today</Badge>}
                    </h3>
                    <div className="space-y-2">
                      {mockSessions.slice(idx, idx + 2).map((session) => {
                        const catColor = categoryColors[session.category] || categoryColors.Other;
                        return (
                          <div
                            key={`${label}-${session.id}`}
                            className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                          >
                            <div className={`w-1.5 h-10 rounded-full ${catColor.includes("indigo") ? "bg-indigo-500" : catColor.includes("rose") ? "bg-rose-500" : catColor.includes("amber") ? "bg-amber-500" : catColor.includes("teal") ? "bg-teal-500" : catColor.includes("sky") ? "bg-sky-500" : "bg-zinc-400"}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{session.taskTitle}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(session.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                {" – "}
                                {new Date(session.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0">
                              {session.plannedDuration}m
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Unscheduled panel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Unscheduled & Overdue
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mockTasks.filter((t) => t.status === "Overdue").map((task) => (
                <div key={task.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/50 p-3 mb-2">
                  <div>
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">{formatDuration(task.remainingDuration)} remaining</p>
                  </div>
                  <Button variant="outline" size="sm">Reschedule</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
