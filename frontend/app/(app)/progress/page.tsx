"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Cell,
} from "recharts";
import {
  Clock,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Target,
  Flame,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
// Effort and session totals have no backend yet, so the aggregate cards and
// charts still read from fixtures. The per-task table below is live.
import { mockTasks } from "@/lib/mock-data";
import { tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import type { AcademicTask } from "@/types/task";
import { formatDuration, STATUS_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";

// ─── Chart data ──────────────────────────────────────────────────
const weeklyEffortData = [
  { week: "Jul 8",  minutes: 300, assignment: 90,  exam: 120, project: 60, reading: 30 },
  { week: "Jul 15", minutes: 450, assignment: 120, exam: 180, project: 90, reading: 60 },
  { week: "Jul 22", minutes: 520, assignment: 150, exam: 200, project: 100, reading: 70 },
  { week: "Jul 29", minutes: 380, assignment: 100, exam: 160, project: 80, reading: 40 },
  { week: "Aug 5",  minutes: 120, assignment: 40,  exam: 60,  project: 20, reading: 0  },
];

const categoryBreakdown = [
  { name: "Assignment",       value: 500, fill: "hsl(243 75% 59%)" },
  { name: "Exam Prep",        value: 720, fill: "hsl(350 89% 60%)" },
  { name: "Project",          value: 350, fill: "hsl(38 92% 50%)"  },
  { name: "Reading",          value: 200, fill: "hsl(168 76% 42%)" },
  { name: "Research/Writing", value: 0,   fill: "hsl(199 89% 48%)" },
];

const weeklyStackedConfig = {
  assignment: { label: "Assignment",  color: "hsl(243 75% 59%)" },
  exam:       { label: "Exam Prep",   color: "hsl(350 89% 60%)" },
  project:    { label: "Project",     color: "hsl(38 92% 50%)"  },
  reading:    { label: "Reading",     color: "hsl(168 76% 42%)" },
} satisfies ChartConfig;

const effortConfig = {
  minutes: { label: "Minutes studied", color: "hsl(var(--chart-5))" },
} satisfies ChartConfig;

// ─── Derived stats ───────────────────────────────────────────────
const totalStudied = mockTasks.reduce((a, t) => a + t.actualDuration, 0);
const totalCompleted = mockTasks.reduce((a, t) => a + t.sessionsCompleted, 0);
const avgSession = totalCompleted > 0 ? Math.round(totalStudied / totalCompleted) : 0;
const onTrack = mockTasks.filter((t) => t.status === "In Progress" || t.status === "Completed").length;

const statCards = [
  {
    label: "Total Studied",
    value: `${Math.floor(totalStudied / 60)}h ${totalStudied % 60}m`,
    sub: "across all tasks",
    icon: Clock,
    trend: +12,
  },
  {
    label: "Sessions Done",
    value: String(totalCompleted),
    sub: "study sessions",
    icon: CheckCircle2,
    trend: +4,
  },
  {
    label: "Avg Session",
    value: `${avgSession}m`,
    sub: "average focus",
    icon: TrendingUp,
    trend: -5,
  },
  {
    label: "On-Track",
    value: String(onTrack),
    sub: "of 8 tasks",
    icon: Target,
    trend: 0,
  },
];

type TabKey = "task" | "week";

export default function ProgressPage() {
  const load = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const { data, error } = useApi(load);
  const liveTasks = useMemo<AcademicTask[]>(() => data ?? [], [data]);

  const [activeTab, setActiveTab] = useState<TabKey>("task");

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Progress</h1>
        <p className="text-sm text-muted-foreground">
          Track your effort and study consistency over time
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{describeError(error)}</AlertDescription>
        </Alert>
      )}

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          The per-task table is live. Totals and charts are sample data until the
          backend records study sessions and logged effort.
        </AlertDescription>
      </Alert>

      {/* Tab bar */}
      <div className="flex gap-1 border-b -mb-px">
        {(["task", "week"] as TabKey[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize",
              activeTab === tab
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === "task" ? "By Task" : "By Week"}
          </button>
        ))}
      </div>

      {/* ── BY TASK ─────────────────────────────── */}
      {activeTab === "task" && (
        <div className="flex flex-col gap-6">

          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map((card) => {
              const Icon = card.icon;
              const TrendIcon = card.trend > 0 ? ArrowUp : card.trend < 0 ? ArrowDown : Minus;
              const trendColor =
                card.trend > 0 ? "text-emerald-600" : card.trend < 0 ? "text-red-500" : "text-muted-foreground";
              return (
                <Card key={card.label}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {card.label}
                        </p>
                        <p className="text-2xl font-bold tracking-tight">{card.value}</p>
                        <p className="text-xs text-muted-foreground">{card.sub}</p>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        {card.trend !== 0 && (
                          <div className={cn("flex items-center gap-0.5 text-[11px] font-medium", trendColor)}>
                            <TrendIcon className="h-3 w-3" />
                            {Math.abs(card.trend)}%
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Charts row */}
          <div className="grid gap-4 lg:grid-cols-7">
            {/* Area chart */}
            <Card className="lg:col-span-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Effort Over Time</CardTitle>
                <CardDescription>Minutes studied per week</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={effortConfig} className="h-[220px] w-full">
                  <AreaChart data={weeklyEffortData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="effortGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-5))" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}m`} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="minutes"
                      stroke="hsl(var(--chart-5))"
                      fill="url(#effortGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Pie chart */}
            <Card className="lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Time by Category</CardTitle>
                <CardDescription>Distribution of study minutes</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4 pt-2">
                <ChartContainer
                  config={{
                    assignment:     { label: "Assignment",       color: "hsl(243 75% 59%)" },
                    exam:           { label: "Exam Prep",        color: "hsl(350 89% 60%)" },
                    project:        { label: "Project",          color: "hsl(38 92% 50%)"  },
                    reading:        { label: "Reading",          color: "hsl(168 76% 42%)" },
                    researchwriting:{ label: "Research/Writing", color: "hsl(199 89% 48%)" },
                  }}
                  className="h-[160px] w-full"
                >
                  <PieChart>
                    <Pie
                      data={categoryBreakdown.filter((d) => d.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={72}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {categoryBreakdown.filter((d) => d.value > 0).map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  </PieChart>
                </ChartContainer>
                {/* Manual legend */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 w-full">
                  {categoryBreakdown.filter((d) => d.value > 0).map((d) => (
                    <div key={d.name} className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ background: d.fill }} />
                      <span className="text-xs text-muted-foreground truncate">{d.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Task effort table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Task Effort Breakdown</CardTitle>
              <CardDescription>
                Progress reflects time invested — not content completion or grade.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="pl-4 w-[260px]">Task</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[180px]">Effort</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right pr-4">Sessions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liveTasks.map((task) => {
                    const statCfg = STATUS_CONFIG[task.status];
                    const pct =
                      task.plannedDuration > 0
                        ? Math.min(100, Math.round((task.actualDuration / task.plannedDuration) * 100))
                        : 0;
                    const isBehind = task.status === "Overdue";
                    return (
                      <TableRow key={task.id}>
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-2">
                            {isBehind && <Flame className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                            <div>
                              <div className="text-sm font-medium">{task.title}</div>
                              {task.course && (
                                <div className="text-xs text-muted-foreground">{task.course}</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              "text-xs border-0 flex w-fit items-center gap-1.5",
                              statCfg.bg,
                              statCfg.color
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 rounded-full", statCfg.dotColor)} />
                            {statCfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-1.5 flex-1" />
                            <span className="text-xs tabular-nums w-7 text-muted-foreground">{pct}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatDuration(task.actualDuration)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {formatDuration(task.remainingDuration)}
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <span className="text-xs">
                            <span className="font-semibold text-foreground">{task.sessionsCompleted}</span>
                            <span className="text-muted-foreground"> / {task.sessionsCompleted + task.sessionsUpcoming}</span>
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── BY WEEK ─────────────────────────────── */}
      {activeTab === "week" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Weekly Effort by Category</CardTitle>
              <CardDescription>Stacked minutes studied per category, per week</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={weeklyStackedConfig} className="h-[300px] w-full">
                <BarChart data={weeklyEffortData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}m`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="assignment" stackId="a" fill="hsl(243 75% 59%)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="exam"       stackId="a" fill="hsl(350 89% 60%)" />
                  <Bar dataKey="project"    stackId="a" fill="hsl(38 92% 50%)" />
                  <Bar dataKey="reading"    stackId="a" fill="hsl(168 76% 42%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Weekly summary table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Weekly Totals</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="pl-4">Week</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right pr-4">vs. Previous</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyEffortData.map((row, i) => {
                    const prev = weeklyEffortData[i - 1]?.minutes;
                    const delta = prev !== undefined ? row.minutes - prev : null;
                    return (
                      <TableRow key={row.week}>
                        <TableCell className="pl-4 font-medium">{row.week}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatDuration(row.minutes)}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          ~{Math.round(row.minutes / 60)} sessions
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          {delta !== null ? (
                            <span
                              className={cn(
                                "text-xs font-medium",
                                delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-muted-foreground"
                              )}
                            >
                              {delta > 0 ? "+" : ""}{formatDuration(Math.abs(delta))}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
