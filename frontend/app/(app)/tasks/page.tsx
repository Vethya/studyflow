"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  ListTodo,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDuration, CATEGORY_CONFIG, PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ApiError, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { localInputToIso } from "@/lib/datetime";
import { CATEGORIES, PRIORITIES, TASK_STATUSES } from "@/types/task";
import type { AcademicTask, Category, Priority, TaskStatus } from "@/types/task";

const ANY = "any";

export default function TasksPage() {
  // Everything except the title search is a real backend query parameter.
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [course, setCourse] = useState("");
  const [appliedCourse, setAppliedCourse] = useState("");
  const [search, setSearch] = useState("");
  // SPEC §17.4 lists "Filter by Deadline"; the API takes RFC 3339 bounds.
  const [dueBefore, setDueBefore] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicTask | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const load = useCallback(
    (signal: AbortSignal) =>
      tasksApi.listTasks(
        {
          status: status ?? undefined,
          category: category ?? undefined,
          priority: priority ?? undefined,
          course: appliedCourse || undefined,
          deadlineTo: dueBefore ? localInputToIso(dueBefore) : undefined,
        },
        signal,
      ),
    [status, category, priority, appliedCourse, dueBefore],
  );
  const { data, error, isLoading, reload, setData } = useApi(load);

  const tasks = useMemo(() => data ?? [], [data]);

  // The API has no title search, so this last step is client-side and says so.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => task.title.toLowerCase().includes(q));
  }, [tasks, search]);

  const filterCount =
    (status ? 1 : 0) +
    (category ? 1 : 0) +
    (priority ? 1 : 0) +
    (appliedCourse ? 1 : 0) +
    (dueBefore ? 1 : 0);

  function clearFilters() {
    setStatus(null);
    setCategory(null);
    setPriority(null);
    setCourse("");
    setAppliedCourse("");
    setDueBefore("");
  }

  function handleSaved(saved: AcademicTask) {
    setData(
      tasks.some((task) => task.id === saved.id)
        ? tasks.map((task) => (task.id === saved.id ? saved : task))
        : [saved, ...tasks],
    );
    toast.success(editing ? "Task updated" : "Task added");
    setEditing(null);
  }

  async function runAction(taskId: string, action: () => Promise<void>, message: string) {
    setBusyTaskId(taskId);
    try {
      await action();
      toast.success(message);
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      {/* ── Header ─────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you owe, with deadlines and estimates.
          </p>
        </div>
        <Button
          className="rounded-full px-4"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add task
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{describeError(error)}</span>
            <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Filters ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={TASK_STATUSES}
          placeholder="Any status"
        />
        <FilterSelect
          value={category}
          onChange={setCategory}
          options={CATEGORIES}
          placeholder="Any category"
        />
        <FilterSelect
          value={priority}
          onChange={setPriority}
          options={PRIORITIES}
          placeholder="Any priority"
        />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedCourse(course.trim());
          }}
        >
          <Input
            placeholder="Course"
            className="h-9 w-36"
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            onBlur={() => setAppliedCourse(course.trim())}
          />
        </form>

        <label className="flex items-center gap-1.5">
          <span className="eyebrow whitespace-nowrap">Due before</span>
          <Input
            type="datetime-local"
            className="h-9 w-[13rem]"
            value={dueBefore}
            onChange={(e) => setDueBefore(e.target.value)}
            aria-label="Show tasks due before"
          />
        </label>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter titles"
            className="h-9 w-44 pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {filterCount > 0 && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        )}

        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {isLoading ? "…" : `${visible.length} shown`}
        </span>
      </div>

      {/* ── Ledger ─────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState hasFilters={filterCount > 0 || search !== ""} onClear={clearFilters} />
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_7rem_6rem_7rem_2.5rem] gap-4 border-b bg-muted/40 px-6 py-2 lg:grid">
                <span className="eyebrow">Task</span>
                <span className="eyebrow">Deadline</span>
                <span className="eyebrow text-right">Remaining</span>
                <span className="eyebrow">Status</span>
                <span />
              </div>

              <ul className="divide-y">
                {visible.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    busy={busyTaskId === task.id}
                    onEdit={() => {
                      setEditing(task);
                      setDialogOpen(true);
                    }}
                    onStart={() =>
                      void runAction(task.id, () => tasksApi.startTask(task.id), "Task started")
                    }
                    onFinish={() =>
                      void runAction(
                        task.id,
                        () => tasksApi.finishTaskEarly(task.id),
                        "Task finished",
                      )
                    }
                    onDelete={() =>
                      void runAction(task.id, () => tasksApi.deleteTask(task.id), "Task deleted")
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <p className="font-mono text-xs text-muted-foreground">
        Status, category, priority, course and deadline are filtered by the server.
        Title filtering happens in your browser — the API has no text search.
      </p>

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        onSaved={handleSaved}
      />
    </div>
  );
}

function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T | null;
  onChange: (next: T | null) => void;
  options: readonly T[];
  placeholder: string;
}) {
  return (
    <Select
      value={value ?? ANY}
      onValueChange={(next) => next && onChange(next === ANY ? null : (next as T))}
    >
      <SelectTrigger className="h-9 w-auto min-w-[9.5rem]">
        {/* Base UI renders the raw value by default, which would show the
            sentinel "any" rather than the option's label. */}
        <SelectValue>{(selected) => (selected === ANY ? placeholder : String(selected))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>{option}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <ListTodo className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        {hasFilters ? "No tasks match these filters." : "No tasks yet."}
      </p>
      {hasFilters && (
        <Button size="sm" variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

function relativeDeadline(deadline: string) {
  const due = new Date(deadline);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, urgent: true };
  if (days === 0) return { label: "Today", urgent: true };
  if (days === 1) return { label: "Tomorrow", urgent: true };
  if (days <= 3) return { label: `${days} days`, urgent: true };
  return {
    label: due.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    urgent: false,
  };
}

function TaskRow({
  task,
  busy,
  onEdit,
  onStart,
  onFinish,
  onDelete,
}: {
  task: AcademicTask;
  busy: boolean;
  onEdit: () => void;
  onStart: () => void;
  onFinish: () => void;
  onDelete: () => void;
}) {
  const category = CATEGORY_CONFIG[task.category];
  const priority = PRIORITY_CONFIG[task.priority];
  const statusConfig = STATUS_CONFIG[task.status];
  const due = relativeDeadline(task.deadline);

  return (
    <li className="group relative py-3 pl-6 pr-14 transition-colors hover:bg-muted/40 lg:pr-6">
      {/* Overdue tasks carry a rule in the margin rather than a tinted row. */}
      {task.status === "Overdue" && (
        <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-deficit" aria-hidden />
      )}

      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem_2.5rem] lg:items-center lg:gap-4">
        <div className="min-w-0">
          <Link
            href={`/tasks/${task.id}`}
            className="block truncate text-sm font-medium underline-offset-4 hover:underline"
          >
            {task.title}
          </Link>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge className={cn("rounded-md border-0 text-[11px]", category.bg, category.color)}>
              {category.label}
            </Badge>
            {task.priority !== "Medium" && (
              <Badge className={cn("rounded-md border-0 text-[11px]", priority.bg, priority.color)}>
                {priority.label}
              </Badge>
            )}
            {task.course && (
              <span className="truncate text-xs text-muted-foreground">{task.course}</span>
            )}
          </div>
        </div>

        {/* `lg:contents` dissolves this wrapper once the grid takes over, so
            the three figures become real columns instead of a nested row. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 lg:contents">
          <span
            className={cn(
              "min-w-0 font-mono text-xs",
              due.urgent ? "text-deficit" : "text-muted-foreground",
            )}
          >
            {due.label}
          </span>

          <span className="min-w-0 font-mono text-xs text-muted-foreground lg:text-right">
            {formatDuration(task.remainingDuration)}
          </span>

          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusConfig.dotColor)} />
            <span className="truncate text-muted-foreground">{statusConfig.label}</span>
          </span>
        </div>

        {/* Pinned to the row corner while stacked; a real grid cell once the
            columns take over. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-2.5 h-8 w-8 lg:static lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
                disabled={busy}
                aria-label={`Actions for ${task.title}`}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem render={<Link href={`/tasks/${task.id}`}>Open</Link>} />
            <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
            {task.status === "Not Started" && (
              <DropdownMenuItem onClick={onStart}>Start</DropdownMenuItem>
            )}
            {task.status === "In Progress" && (
              <DropdownMenuItem onClick={onFinish}>Finish early</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
