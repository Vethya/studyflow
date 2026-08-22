"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Clock,
  ListTodo,
  TrendingUp,
  Plus,
  RefreshCw,
  AlertTriangle,
  CalendarClock,
  History,
  ArrowUpRight,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { mockTasks, mockSessions } from "@/lib/mock-data";
import { formatDuration, STATUS_CONFIG, PRIORITY_CONFIG, CATEGORY_CONFIG } from "@/lib/constants";

// ─── Chart data ─────────────────────────────────────────────────
const studyTimeData = [
  { day: "Mon", minutes: 120 },
  { day: "Tue", minutes: 90 },
  { day: "Wed", minutes: 60 },
  { day: "Thu", minutes: 150 },
  { day: "Fri", minutes: 45 },
  { day: "Sat", minutes: 180 },
  { day: "Sun", minutes: 100 },
];

const categoryData = [
  { category: "Assignment", sessions: 8, fill: "var(--color-assignment)" },
  { category: "Reading", sessions: 4, fill: "var(--color-reading)" },
  { category: "Exam Prep", sessions: 12, fill: "var(--color-exam)" },
  { category: "Project", sessions: 6, fill: "var(--color-project)" },
  { category: "Research", sessions: 3, fill: "var(--color-research)" },
];

const monthlyData = [
  { week: "Week 1", hours: 8 },
  { week: "Week 2", hours: 12 },
  { week: "Week 3", hours: 10 },
  { week: "Week 4", hours: 15 },
];

const studyTimeConfig = {
  minutes: { label: "Minutes", color: "hsl(var(--chart-5))" },
} satisfies ChartConfig;

const categoryConfig = {
  sessions: { label: "Sessions" },
  assignment: { label: "Assignment", color: "hsl(243 75% 59%)" },
  reading: { label: "Reading", color: "hsl(168 76% 42%)" },
  exam: { label: "Exam Prep", color: "hsl(350 89% 60%)" },
  project: { label: "Project", color: "hsl(38 92% 50%)" },
  research: { label: "Research", color: "hsl(199 89% 48%)" },
} satisfies ChartConfig;

const monthlyConfig = {
  hours: { label: "Hours", color: "hsl(var(--chart-5))" },
} satisfies ChartConfig;

// ─── Derived data ───────────────────────────────────────────────
const todaySessions = mockSessions.filter(
  (s) => !s.outcome && !s.isAwaitingOutcome && new Date(s.startTime).toDateString() === new Date().toDateString()
);
const todayWorkload = todaySessions.reduce((sum, s) => sum + s.plannedDuration, 0);
const totalStudied = mockTasks.reduce((sum, t) => sum + t.actualDuration, 0);
const totalPlanned = mockTasks.reduce((sum, t) => sum + t.plannedDuration, 0);
const weeklyEffort = totalPlanned > 0 ? Math.round((totalStudied / totalPlanned) * 100) : 0;
const nextSession = todaySessions[0];
const upcomingDeadlines = [...mockTasks]
  .filter((t) => t.status !== "Completed")
  .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
  .slice(0, 5);
const awaitingOutcome = mockSessions.filter((s) => s.isAwaitingOutcome);
const overdueTasks = mockTasks.filter((t) => t.status === "Overdue");

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            What needs attention now
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Regenerate schedule
          </Button>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add task
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="agenda">Next 14 Days</TabsTrigger>
          <TabsTrigger value="unscheduled">Unscheduled</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Row 1 — Stat cards + study time chart */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Next Session */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Next Session</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {nextSession ? (
                  <>
                    <div className="text-2xl font-bold">in 2h 15m</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {nextSession.taskTitle}
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant="secondary" className="text-xs">
                        {nextSession.plannedDuration} min
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(nextSession.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-bold">—</div>
                    <p className="text-xs text-muted-foreground mt-1">No sessions today</p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Today's Workload */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Today&apos;s Workload</CardTitle>
                <ListTodo className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatDuration(todayWorkload)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  across {todaySessions.length} sessions
                </p>
                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                  <span>{todaySessions.length} upcoming</span>
                  <span>·</span>
                  <span>0 done</span>
                </div>
              </CardContent>
            </Card>

            {/* Weekly Effort */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Weekly Effort</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{weeklyEffort}%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDuration(totalStudied)} / {formatDuration(totalPlanned)}
                </p>
                <Progress value={weeklyEffort} className="mt-3 h-2" />
              </CardContent>
            </Card>

            {/* Study Time chart */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Study Time</CardTitle>
                <div className="flex items-center text-xs text-green-600">
                  <ArrowUpRight className="h-3 w-3 mr-1" />
                  12%
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatDuration(studyTimeData.reduce((s, d) => s + d.minutes, 0))}
                </div>
                <p className="text-xs text-muted-foreground mb-3">Last 7 days</p>
                <ChartContainer config={studyTimeConfig} className="h-[60px] w-full">
                  <AreaChart data={studyTimeData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <Area
                      type="monotone"
                      dataKey="minutes"
                      stroke="var(--color-minutes)"
                      fill="var(--color-minutes)"
                      fillOpacity={0.1}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          {/* Row 2 — Charts */}
          <div className="grid gap-4 md:grid-cols-7">
            <Card className="md:col-span-4">
              <CardHeader>
                <CardTitle className="text-base">Study Activity</CardTitle>
                <CardDescription>Weekly study hours this month</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={monthlyConfig} className="h-[250px] w-full">
                  <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `${v}h`} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="hours"
                      stroke="var(--color-hours)"
                      fill="var(--color-hours)"
                      fillOpacity={0.1}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="md:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Sessions by Category</CardTitle>
                <CardDescription>Distribution of study sessions</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={categoryConfig} className="h-[250px] w-full">
                  <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis type="category" dataKey="category" tickLine={false} axisLine={false} fontSize={12} width={80} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="sessions" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          {/* Row 3 — Deadlines table + Needs attention */}
          <div className="grid gap-4 md:grid-cols-7">
            <Card className="md:col-span-4">
              <CardHeader>
                <CardTitle className="text-base">Upcoming Deadlines</CardTitle>
                <CardDescription>Tasks due soonest</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcomingDeadlines.map((task) => {
                      const catCfg = CATEGORY_CONFIG[task.category];
                      const priCfg = PRIORITY_CONFIG[task.priority];
                      return (
                        <TableRow key={task.id}>
                          <TableCell>
                            <div className="font-medium">{task.title}</div>
                            {task.course && (
                              <div className="text-xs text-muted-foreground">{task.course}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`${catCfg.color} ${catCfg.bg} border-0`}>
                              {catCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {new Date(task.deadline).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`${priCfg.color} ${priCfg.bg} border-0`}>
                              {priCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatDuration(task.remainingDuration)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="md:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Needs Attention</CardTitle>
                <CardDescription>Items requiring your action</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Overdue tasks */}
                {overdueTasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Overdue: {task.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDuration(task.remainingDuration)} remaining — set a new deadline
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" className="text-xs shrink-0">
                      Fix
                    </Button>
                  </div>
                ))}

                {/* Awaiting outcomes */}
                {awaitingOutcome.map((session) => (
                  <div key={session.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                      <History className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Awaiting Outcome</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {session.taskTitle} — {session.plannedDuration} min session
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" className="text-xs shrink-0">
                      Record
                    </Button>
                  </div>
                ))}

                {/* Unscheduled work notice */}
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                    <CalendarClock className="h-4 w-4 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Unscheduled Work</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      75 min from &quot;Ethics in AI&quot; needs a new deadline
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs shrink-0">
                    Resolve
                  </Button>
                </div>

                {overdueTasks.length === 0 && awaitingOutcome.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">All clear! 🎉</p>
                    <p className="text-xs mt-1">Nothing needs your attention right now.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Next 14 Days Tab */}
        <TabsContent value="agenda" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Next 14 Days Agenda</CardTitle>
              <CardDescription>Upcoming sessions across the next two weeks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {["Today", "Tomorrow", "Wed, Aug 5", "Thu, Aug 6", "Fri, Aug 7"].map((day, idx) => (
                  <div key={day}>
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      {day}
                      {idx === 0 && <Badge variant="secondary" className="text-[10px]">Today</Badge>}
                    </h3>
                    <div className="space-y-2">
                      {(idx < 2 ? mockSessions.filter((s, i) => i % 3 === idx).slice(0, 2) : mockSessions.slice(0, 1)).map((session) => (
                        <div
                          key={`${day}-${session.id}`}
                          className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                        >
                          <div className="w-1 h-8 rounded-full bg-primary" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{session.taskTitle}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(session.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {" – "}
                              {new Date(session.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {session.plannedDuration}m
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Unscheduled Tab */}
        <TabsContent value="unscheduled" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unscheduled Work</CardTitle>
              <CardDescription>Work that currently has no valid study session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {overdueTasks.map((task) => (
                <div key={task.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">{task.title}</h4>
                      {task.course && <p className="text-xs text-muted-foreground mt-0.5">{task.course}</p>}
                    </div>
                    <Badge variant="outline" className="text-red-700 bg-red-50 border-0">Overdue</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground">Remaining</span>
                      <p className="font-semibold mt-0.5">{formatDuration(task.remainingDuration)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Original deadline</span>
                      <p className="font-semibold mt-0.5">{new Date(task.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Remedy</span>
                      <p className="font-semibold mt-0.5 text-amber-700">Set new deadline</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" size="sm">Extend Deadline</Button>
                    <Button variant="outline" size="sm">Add Availability</Button>
                  </div>
                </div>
              ))}
              {overdueTasks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <CalendarClock className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">No unscheduled work</p>
                  <p className="text-xs mt-1">All your tasks have valid study sessions.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
