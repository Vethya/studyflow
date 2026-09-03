"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
  ArrowUpDown,
  ListTodo,
  SlidersHorizontal,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDuration, CATEGORY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import { describeDeadline } from "@/lib/datetime";
import { EmptyState, PageHeader, PageShell } from "@/components/page-kit";
import { cn } from "@/lib/utils";
import { ApiError, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { localInputToIso } from "@/lib/datetime";
import { CATEGORIES, PRIORITIES, TASK_STATUSES } from "@/types/task";
import type { AcademicTask, Category, Priority, TaskStatus } from "@/types/task";

const ANY = "any";

type SortKey = "deadline" | "deadline-desc" | "priority" | "remaining" | "title";

const SORT_LABELS: Record<SortKey, string> = {
  deadline: "Soonest first",
  "deadline-desc": "Latest first",
  priority: "Priority",
  remaining: "Most work left",
  title: "Name (A–Z)",
};

export default function TasksPage() {
  // Everything except the title search is a real backend query parameter.
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [course, setCourse] = useState("");
  const [appliedCourse, setAppliedCourse] = useState("");
  const [search, setSearch] = useState("");
  // The API takes RFC 3339 bounds for the deadline filter.
  const [dueBefore, setDueBefore] = useState("");
  const [sort, setSort] = useState<SortKey>("deadline");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicTask | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  // SPEC §7.8 and §7.5: both of these destroy work, so both confirm first.
  const [confirmDelete, setConfirmDelete] = useState<AcademicTask | null>(null);
  const [confirmFinish, setConfirmFinish] = useState<AcademicTask | null>(null);

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

  // The API has no text search, so title filtering happens here in the browser.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => task.title.toLowerCase().includes(q));
  }, [tasks, search]);

  const visibleSorted = useMemo(() => {
    const rows = [...visible];
    const byDeadline = (a: AcademicTask, b: AcademicTask) =>
      new Date(a.deadline).getTime() - new Date(b.deadline).getTime();

    switch (sort) {
      case "deadline":
        return rows.sort(byDeadline);
      case "deadline-desc":
        return rows.sort((a, b) => byDeadline(b, a));
      case "remaining":
        return rows.sort((a, b) => b.remainingDuration - a.remainingDuration);
      case "priority": {
        // High first, then Medium, then Low; ties fall back to the deadline so
        // the order is stable rather than whatever the API happened to return.
        const rank: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
        return rows.sort((a, b) => rank[a.priority] - rank[b.priority] || byDeadline(a, b));
      }
      case "title":
        return rows.sort((a, b) => a.title.localeCompare(b.title));
      default:
        return rows;
    }
  }, [visible, sort]);

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
    setSearch("");
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
    <PageShell>
      <PageHeader
        title="Tasks"
        description="Everything you owe, with deadlines and estimates."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus />
            Add task
          </Button>
        }
      />

      {error && (
        <Callout
          tone="danger"
          title="Could not load your tasks"
          actions={
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        >
          {describeError(error)}
        </Callout>
      )}

      {/* ── Toolbar ────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search leads, because it is what a long list is actually used
              with. It used to be the fifth control in a wrapped row of seven. */}
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tasks"
              aria-label="Search tasks by title"
              className="h-10 w-full ps-9 pe-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <Select value={sort} onValueChange={(next) => next && setSort(next as SortKey)}>
            <SelectTrigger className="h-10" aria-label="Sort tasks">
              <ArrowUpDown className="text-muted-foreground" />
              <SelectValue>
                {(selected) => SORT_LABELS[selected as SortKey] ?? "Sort"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SORT_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* The five filters live behind one control instead of spilling
              across two wrapped rows of half-labelled inputs. */}
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline" className="h-10">
                  <SlidersHorizontal />
                  Filters
                  {filterCount > 0 && (
                    <span className="ms-0.5 flex size-5 items-center justify-center rounded-full bg-foreground text-[0.6875rem] font-semibold text-background">
                      {filterCount}
                    </span>
                  )}
                </Button>
              }
            />
            <PopoverContent align="end" className="w-80 p-4">
              <div className="space-y-3">
                <FilterField label="Status">
                  <FilterSelect
                    value={status}
                    onChange={setStatus}
                    options={TASK_STATUSES}
                    placeholder="Any status"
                  />
                </FilterField>
                <FilterField label="Category">
                  <FilterSelect
                    value={category}
                    onChange={setCategory}
                    options={CATEGORIES}
                    placeholder="Any category"
                  />
                </FilterField>
                <FilterField label="Priority">
                  <FilterSelect
                    value={priority}
                    onChange={setPriority}
                    options={PRIORITIES}
                    placeholder="Any priority"
                  />
                </FilterField>
                <FilterField label="Course">
                  <Input
                    placeholder="Any course"
                    className="h-9 w-full"
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    onBlur={() => setAppliedCourse(course.trim())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setAppliedCourse(course.trim());
                    }}
                  />
                </FilterField>
                <FilterField label="Due before">
                  <Input
                    type="datetime-local"
                    className="h-9 w-full"
                    value={dueBefore}
                    onChange={(e) => setDueBefore(e.target.value)}
                    aria-label="Show tasks due before"
                  />
                </FilterField>

                {filterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={clearFilters}
                  >
                    Clear all filters
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Active filters stay visible outside the popover, each removable on
            its own — otherwise a filtered list looks like an empty one. */}
        {(filterCount > 0 || search !== "") && (
          <div className="flex flex-wrap items-center gap-2">
            {search && <Chip label={`“${search}”`} onClear={() => setSearch("")} />}
            {status && <Chip label={status} onClear={() => setStatus(null)} />}
            {category && <Chip label={category} onClear={() => setCategory(null)} />}
            {priority && <Chip label={`${priority} priority`} onClear={() => setPriority(null)} />}
            {appliedCourse && (
              <Chip
                label={appliedCourse}
                onClear={() => {
                  setCourse("");
                  setAppliedCourse("");
                }}
              />
            )}
            {dueBefore && (
              <Chip label="Due before set" onClear={() => setDueBefore("")} />
            )}
            <button
              onClick={clearFilters}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Clear all
            </button>
            <span className="ms-auto text-xs text-muted-foreground">
              {isLoading ? "…" : `${visibleSorted.length} of ${tasks.length}`}
            </span>
          </div>
        )}
      </div>

      {/* ── Ledger ─────────────────────────────── */}
      {/* `py-0`: Card applies `py-(--card-spacing)` by default, which left a
          band of empty space above the first row and below the last. */}
      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={
                filterCount > 0 || search !== ""
                  ? "No tasks match these filters"
                  : "No tasks yet"
              }
              className="border-0"
              action={
                filterCount > 0 || search !== "" ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            >
              {filterCount > 0 || search !== ""
                ? "Try widening the filters above."
                : "Add your first task to see how it fits your week."}
            </EmptyState>
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_7rem_6rem_7rem_2.5rem] gap-4 border-b bg-muted/40 px-6 py-2 lg:grid">
                <span className="text-xs font-medium text-muted-foreground">Task</span>
                <span className="text-xs font-medium text-muted-foreground">Due</span>
                <span className="text-end text-xs font-medium text-muted-foreground">Left</span>
                <span className="text-xs font-medium text-muted-foreground">Status</span>
                <span />
              </div>

              <ul className="divide-y">
                {visibleSorted.map((task) => (
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
                    onFinish={() => setConfirmFinish(task)}
                    onDelete={() => setConfirmDelete(task)}
                  />
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        onSaved={handleSaved}
      />

      {/* SPEC §7.8: deletion also removes sessions and behaviour history, so
          the dialog names what goes rather than asking "are you sure?". */}
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(next) => !next && setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.title ?? ""}”?`}
        description="This also removes its study sessions and the record of time you have already put in. It cannot be undone."
        confirmLabel="Delete task"
        destructive
        onConfirm={async () => {
          const target = confirmDelete;
          if (!target) return;
          await runAction(target.id, () => tasksApi.deleteTask(target.id), "Task deleted");
          setConfirmDelete(null);
        }}
      />

      {/* SPEC §7.5: finishing early zeroes remaining work and drops future
          sessions, but keeps the time already recorded. */}
      <ConfirmDialog
        open={confirmFinish !== null}
        onOpenChange={(next) => !next && setConfirmFinish(null)}
        title={`Finish “${confirmFinish?.title ?? ""}” now?`}
        description="StudyFlow will treat this task as done, drop its upcoming sessions, and keep the time you have already logged."
        confirmLabel="Mark it finished"
        onConfirm={async () => {
          const target = confirmFinish;
          if (!target) return;
          await runAction(target.id, () => tasksApi.finishTaskEarly(target.id), "Task finished");
          setConfirmFinish(null);
        }}
      />
    </PageShell>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** A removable summary of one active filter. */
function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-full border bg-card py-1 ps-2.5 pe-1 text-xs">
      <span className="max-w-40 truncate">{label}</span>
      <button
        onClick={onClear}
        aria-label={`Remove ${label} filter`}
        className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
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
      <SelectTrigger className="h-9 w-full">
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
  const statusConfig = STATUS_CONFIG[task.status];
  const due = describeDeadline(task.deadline);

  return (
    <li className="group relative py-3 pl-6 pr-14 transition-colors hover:bg-muted/40 lg:pr-6">
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem_2.5rem] lg:items-center lg:gap-4">
        <div className="min-w-0">
          <Link
            href={`/tasks/${task.id}`}
            className="block truncate text-sm font-medium underline-offset-4 hover:underline"
          >
            {task.title}
          </Link>
          {/* Category and course are attributes, not signals, so they stay in
              ink. Only High priority earns a chip — Medium is the default and
              Low is not worth the reader's attention. */}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {task.priority === "High" && (
              <Badge variant="outline" className="px-1.5 text-[0.6875rem]">
                High
              </Badge>
            )}
            <span className="truncate text-xs text-muted-foreground">
              {category.label}
              {task.course ? ` · ${task.course}` : ""}
            </span>
          </div>
        </div>

        {/* `lg:contents` dissolves this wrapper once the grid takes over, so
            the three figures become real columns instead of a nested row. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 lg:contents">
          <span
            className={cn(
              "min-w-0 text-xs font-medium tabular-nums",
              due.urgent ? "text-deficit" : "text-muted-foreground",
            )}
          >
            {due.short}
          </span>

          <span className="min-w-0 text-xs tabular-nums text-muted-foreground lg:text-end">
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
