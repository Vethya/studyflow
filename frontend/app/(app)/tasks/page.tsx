"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  MoreHorizontal,
  ListTodo,
  Clock,
  CheckCircle2,
  AlertCircle,
  CircleDashed,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDuration, CATEGORY_CONFIG, PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ApiError, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { TaskFormDialog } from "@/components/task-form-dialog";
import type { AcademicTask } from "@/types/task";

type TabValue = "all" | "in-progress" | "not-started" | "completed" | "overdue";

const tabs: { value: TabValue; label: string; icon: React.ElementType }[] = [
  { value: "all",          label: "All",         icon: ListTodo },
  { value: "in-progress",  label: "In Progress",  icon: Clock },
  { value: "not-started",  label: "Not Started",  icon: CircleDashed },
  { value: "completed",    label: "Completed",    icon: CheckCircle2 },
  { value: "overdue",      label: "Overdue",      icon: AlertCircle },
];

const TAB_STATUS: Record<Exclude<TabValue, "all">, AcademicTask["status"]> = {
  "in-progress": "In Progress",
  "not-started": "Not Started",
  completed: "Completed",
  overdue: "Overdue",
};

function getRelativeDeadline(deadline: string) {
  const now = new Date();
  const due = new Date(deadline);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, urgent: "overdue" as const };
  if (diffDays === 0) return { label: "Due today", urgent: "today" as const };
  if (diffDays === 1) return { label: "Tomorrow", urgent: "soon" as const };
  if (diffDays <= 3) return { label: `${diffDays} days`, urgent: "soon" as const };
  return {
    label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    urgent: "normal" as const,
  };
}

export default function TasksPage() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicTask | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // Status filtering happens server-side; the counts need the unfiltered list,
  // so the whole set is fetched once and narrowed in the browser.
  const load = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const { data, error, isLoading, reload, setData } = useApi(load);

  const allTasks = useMemo(() => data ?? [], [data]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTasks.filter((task) => {
      const matchesSearch =
        q === "" ||
        task.title.toLowerCase().includes(q) ||
        (task.course?.toLowerCase().includes(q) ?? false);
      if (activeTab === "all") return matchesSearch;
      return matchesSearch && task.status === TAB_STATUS[activeTab];
    });
  }, [allTasks, search, activeTab]);

  const getCount = (tab: TabValue) =>
    tab === "all"
      ? allTasks.length
      : allTasks.filter((task) => task.status === TAB_STATUS[tab]).length;

  function handleSaved(saved: AcademicTask) {
    setData(
      allTasks.some((task) => task.id === saved.id)
        ? allTasks.map((task) => (task.id === saved.id ? saved : task))
        : [saved, ...allTasks],
    );
    toast.success(editing ? "Task updated" : "Task added");
    setEditing(null);
  }

  /** Runs a mutation, then reloads so server-derived status stays authoritative. */
  async function runAction(taskId: string, action: () => Promise<void>, successMessage: string) {
    setBusyTaskId(taskId);
    try {
      await action();
      toast.success(successMessage);
      reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast.error("Start the task before finishing it early.");
      } else {
        toast.error(describeError(cause));
      }
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── Header ─────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading your academic workload…"
              : `Manage your academic workload — ${allTasks.length} tasks total`}
          </p>
        </div>
        <Button
          className="w-fit"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add task
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{describeError(error)}</span>
            <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Tab bar ────────────────────────────── */}
      <div className="flex gap-1 border-b overflow-x-auto pb-0 -mb-px">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const count = getCount(tab.value);
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0 text-[11px] font-semibold tabular-nums",
                  isActive
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Toolbar ────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by title or course…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Table ──────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[280px] pl-4">Task</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead className="w-[160px]">Effort</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7} className="py-3 pl-4">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ListTodo className="h-8 w-8 opacity-30" />
                      <span className="text-sm">
                        {allTasks.length === 0
                          ? "No tasks yet. Add your first one to get started."
                          : "No tasks match your search."}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredTasks.map((task) => {
                  const catCfg = CATEGORY_CONFIG[task.category];
                  const priCfg = PRIORITY_CONFIG[task.priority];
                  const statCfg = STATUS_CONFIG[task.status];
                  const effortPct =
                    task.plannedDuration > 0
                      ? Math.min(100, Math.round((task.actualDuration / task.plannedDuration) * 100))
                      : 0;
                  const dl = getRelativeDeadline(task.deadline);
                  const isOverdue = task.status === "Overdue";
                  const isBusy = busyTaskId === task.id;

                  return (
                    <TableRow
                      key={task.id}
                      className={cn(
                        "group transition-colors",
                        isOverdue && "bg-red-50/40"
                      )}
                    >
                      {/* Left accent bar for overdue */}
                      <TableCell className="pl-4">
                        <div className="flex items-start gap-2">
                          {isOverdue && (
                            <div className="mt-1 h-4 w-0.5 shrink-0 rounded-full bg-red-500" />
                          )}
                          <div>
                            <div className="font-medium text-sm leading-snug">{task.title}</div>
                            {task.course && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {task.course}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge
                          className={cn(
                            "text-xs font-medium border-0 rounded-md",
                            catCfg.bg,
                            catCfg.color
                          )}
                        >
                          {catCfg.label}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <Badge
                          className={cn(
                            "text-xs font-medium border-0 rounded-md",
                            priCfg.bg,
                            priCfg.color
                          )}
                        >
                          {priCfg.label}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            dl.urgent === "overdue" && "text-red-600",
                            dl.urgent === "today" && "text-orange-600",
                            dl.urgent === "soon" && "text-amber-600",
                            dl.urgent === "normal" && "text-muted-foreground"
                          )}
                        >
                          {dl.label}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">{formatDuration(task.actualDuration)}</span>
                            <span className="font-medium tabular-nums">{formatDuration(task.plannedDuration)}</span>
                          </div>
                          <Progress value={effortPct} className="h-1.5" />
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge
                          className={cn(
                            "text-xs font-medium border-0 rounded-md flex w-fit items-center gap-1.5",
                            statCfg.bg,
                            statCfg.color
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statCfg.dotColor)} />
                          {statCfg.label}
                        </Badge>
                      </TableCell>

                      <TableCell className="pr-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                disabled={isBusy}
                              >
                                {isBusy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="h-4 w-4" />
                                )}
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditing(task);
                                setDialogOpen(true);
                              }}
                            >
                              Edit task
                            </DropdownMenuItem>
                            {task.status === "Not Started" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  void runAction(
                                    task.id,
                                    () => tasksApi.startTask(task.id),
                                    "Task started",
                                  )
                                }
                              >
                                Start task
                              </DropdownMenuItem>
                            )}
                            {task.status === "In Progress" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  void runAction(
                                    task.id,
                                    () => tasksApi.finishTaskEarly(task.id),
                                    "Task finished",
                                  )
                                }
                              >
                                Finish early
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() =>
                                void runAction(
                                  task.id,
                                  () => tasksApi.deleteTask(task.id),
                                  "Task deleted",
                                )
                              }
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t bg-muted/30">
            <p className="text-xs text-muted-foreground">
              {filteredTasks.length} of {allTasks.length} tasks
            </p>
          </div>
        </CardContent>
      </Card>

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        onSaved={handleSaved}
      />
    </div>
  );
}
