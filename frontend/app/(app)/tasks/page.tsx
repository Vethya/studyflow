"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowUpDown,
  Check,
  ListTodo,
  SlidersHorizontal,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  X,
} from "@/components/icons";
import { toast } from "sonner";
import { formatDuration } from "@/lib/constants";
import { CategoryTag, EmptyState, PageHeader, PageShell } from "@/components/page-kit";
import { DueChip, EffortBar } from "@/components/study-kit";
import {
  GoogleImportButton,
  GoogleImportReminder,
} from "@/components/google-import-button";
import { cn } from "@/lib/utils";
import { ApiError, tasks as tasksApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { useConfirmDeleteTask } from "@/components/use-confirm-delete-task";
import { localInputToIso } from "@/lib/datetime";
import { applyTaskOverlays, scheduleUndoable, useTaskOverlayVersion } from "@/lib/undo";
import { CATEGORIES, PRIORITIES } from "@/types/task";
import type { AcademicTask, Category, Priority, TaskStatus } from "@/types/task";
import { taskListKey } from "@/lib/swr-keys";
import { useAccountTimezone } from "@/hooks/use-account-timezone";
import { useNow } from "@/hooks/use-now";

const ANY = "any";
const ALL = "all";

type SortKey = "deadline" | "deadline-desc" | "priority" | "remaining" | "title";

const SORT_LABELS: Record<SortKey, string> = {
  deadline: "Soonest first",
  "deadline-desc": "Latest first",
  priority: "Priority",
  remaining: "Most work left",
  title: "Name (A–Z)",
};

const STATUS_TABS: { value: TaskStatus | typeof ALL; label: string }[] = [
  { value: ALL, label: "All" },
  { value: "Not Started", label: "To do" },
  { value: "In Progress", label: "In progress" },
  { value: "Overdue", label: "Overdue" },
  { value: "Completed", label: "Done" },
];

/** Readable URL values, so a filtered list can be bookmarked or shared. */
const STATUS_SLUGS: Record<TaskStatus, string> = {
  "Not Started": "todo",
  "In Progress": "in-progress",
  Overdue: "overdue",
  Completed: "done",
};
const slugify = (value: string) => value.toLowerCase().replace(/\s+/g, "-");

function fromParam<T extends string>(value: string | null, options: readonly T[], slug: (option: T) => string = slugify): T | null {
  return options.find((option) => slug(option) === value) ?? null;
}

/** The list's filters and order as the address bar states them. Key order matters: it is compared as JSON. */
function parseListParams(params: URLSearchParams) {
  return {
    status: fromParam(params.get("status"), Object.keys(STATUS_SLUGS) as TaskStatus[], (s) => STATUS_SLUGS[s]),
    category: fromParam(params.get("category"), CATEGORIES),
    priority: fromParam(params.get("priority"), PRIORITIES),
    course: params.get("course") ?? "",
    due: params.get("due") ?? "",
    sort: fromParam(params.get("sort"), Object.keys(SORT_LABELS) as SortKey[], (key) => key) ?? ("deadline" as SortKey),
  };
}

type GroupId = "overdue" | "week" | "later" | "done";
const GROUP_LABELS: Record<GroupId, string> = {
  overdue: "Overdue",
  week: "Due in the next 7 days",
  later: "Later",
  done: "Done",
};

function TasksContent() {
  const timeZone = useAccountTimezone();
  const searchParams = useSearchParams();
  const fromUrl = parseListParams(searchParams);
  // Everything except the title search is a real backend query parameter.
  const [status, setStatus] = useState<TaskStatus | null>(fromUrl.status);
  const [category, setCategory] = useState<Category | null>(fromUrl.category);
  const [priority, setPriority] = useState<Priority | null>(fromUrl.priority);
  const [course, setCourse] = useState(fromUrl.course);
  const [appliedCourse, setAppliedCourse] = useState(fromUrl.course);
  const [search, setSearch] = useState(
    () => searchParams.get("search") ?? searchParams.get("q") ?? "",
  );
  // The API takes RFC 3339 bounds for the deadline filter.
  const [dueBefore, setDueBefore] = useState(fromUrl.due);
  const [sort, setSort] = useState<SortKey>(fromUrl.sort);

  // A link to `/tasks?status=…` opened while already here changes the URL
  // without remounting the page, so the filters follow it. Our own
  // replaceState below writes what the state already says, which is skipped.
  const urlKey = JSON.stringify(fromUrl);
  const [seenUrlKey, setSeenUrlKey] = useState(urlKey);
  if (urlKey !== seenUrlKey) {
    setSeenUrlKey(urlKey);
    const stateKey = JSON.stringify({ status, category, priority, course: appliedCourse, due: dueBefore, sort });
    if (urlKey !== stateKey) {
      setStatus(fromUrl.status);
      setCategory(fromUrl.category);
      setPriority(fromUrl.priority);
      setCourse(fromUrl.course);
      setAppliedCourse(fromUrl.course);
      setDueBefore(fromUrl.due);
      setSort(fromUrl.sort);
    }
  }

  // Keep the tab, filters and order in the address bar without a navigation,
  // so reloading or sharing the page shows the same list. The title search
  // is left out: it remounts the page when it changes.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const put = (key: string, value: string | null) => (value ? params.set(key, value) : params.delete(key));
    put("status", status && STATUS_SLUGS[status]);
    put("category", category && slugify(category));
    put("priority", priority && slugify(priority));
    put("course", appliedCourse);
    put("due", dueBefore);
    put("sort", sort === "deadline" ? null : sort);
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [status, category, priority, appliedCourse, dueBefore, sort]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicTask | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  // SPEC §7.5: finishing early drops future sessions, so it confirms first.
  // Deleting relies on the undo toast instead.
  const [confirmFinish, setConfirmFinish] = useState<AcademicTask | null>(null);

  const filters = useMemo(
    () => ({
      status: status ?? undefined,
      category: category ?? undefined,
      priority: priority ?? undefined,
      course: appliedCourse || undefined,
      deadlineTo: dueBefore ? localInputToIso(dueBefore, timeZone) : undefined,
    }),
    [status, category, priority, appliedCourse, dueBefore, timeZone],
  );
  const load = useCallback(
    (signal: AbortSignal) => tasksApi.listTasks(filters, signal),
    [filters],
  );
  const { data, error, isLoading, reload, setData } = useApi(taskListKey(filters), load);
  const overlayVersion = useTaskOverlayVersion();

  const tasks = useMemo(() => data ?? [], [data]);

  // Pending finishes and deletions show immediately; a finished task leaves a
  // list that is filtered to another status.
  const visible = useMemo(() => {
    void overlayVersion;
    const q = search.trim().toLowerCase();
    return applyTaskOverlays(tasks).filter(
      (task) =>
        (!status || task.status === status) &&
        (!q || task.title.toLowerCase().includes(q) || (task.course ?? "").toLowerCase().includes(q)),
    );
  }, [tasks, search, status, overlayVersion]);

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

  // Grouped by when it is due, but only in the default order: grouping a list
  // sorted by name or effort would scatter it.
  const nowMs = useNow().getTime();
  const groups = useMemo(() => {
    if (sort !== "deadline") return [{ id: null, tasks: visibleSorted }];
    const now = nowMs;
    const weekEnd = now + 7 * 86_400_000;
    const buckets: Record<GroupId, AcademicTask[]> = { overdue: [], week: [], later: [], done: [] };
    for (const task of visibleSorted) {
      const due = new Date(task.deadline).getTime();
      if (task.status === "Completed") buckets.done.push(task);
      else if (due < now) buckets.overdue.push(task);
      else if (due <= weekEnd) buckets.week.push(task);
      else buckets.later.push(task);
    }
    return (Object.keys(buckets) as GroupId[])
      .filter((id) => buckets[id].length > 0)
      .map((id) => ({ id, tasks: buckets[id] }));
  }, [visibleSorted, sort, nowMs]);

  const filterCount =
    (category ? 1 : 0) +
    (priority ? 1 : 0) +
    (appliedCourse ? 1 : 0) +
    (dueBefore ? 1 : 0);
  const narrowed = filterCount > 0 || search !== "" || status !== null;

  function clearFilters() {
    setStatus(null);
    setCategory(null);
    setPriority(null);
    setCourse("");
    setAppliedCourse("");
    setDueBefore("");
    setSearch("");
  }

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
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

  async function startTask(task: AcademicTask) {
    if (busyTaskId !== null) return;
    const previousIndex = tasks.findIndex((t) => t.id === task.id);
    setData((current) =>
      (current ?? []).map((t) => (t.id === task.id ? { ...t, status: "In Progress" } : t)),
    );
    setBusyTaskId(task.id);
    try {
      await tasksApi.startTask(task.id);
      toast.success("Task started");
    } catch (cause) {
      setData((current) => {
        const list = current ?? [];
        return list.some((t) => t.id === task.id)
          ? list.map((t) => (t.id === task.id ? task : t))
          : [...list.slice(0, previousIndex), task, ...list.slice(previousIndex)];
      });
      reload();
      toast.error(describeError(cause));
    } finally {
      setBusyTaskId(null);
    }
  }

  function finishTask(target: AcademicTask) {
    scheduleUndoable({
      key: `finish:${target.id}`,
      message: "Task finished",
      description: target.title,
      overlay: { taskId: target.id, patch: { status: "Completed", remainingDuration: 0 } },
      commit: () => tasksApi.finishTaskEarly(target.id),
      onError: (cause) => {
        reload();
        return cause instanceof ApiError && cause.status === 409
          ? "Start the task before marking it done."
          : describeError(cause);
      },
    });
  }

  function deleteTask(target: AcademicTask) {
    scheduleUndoable({
      key: `delete:${target.id}`,
      message: "Task deleted",
      description: target.title,
      overlay: { taskId: target.id, removed: true },
      commit: () => tasksApi.deleteTask(target.id),
      onError: (cause) => {
        reload();
        return describeError(cause);
      },
    });
  }

  const { requestDelete, dialog } = useConfirmDeleteTask(deleteTask);

  return (
    <PageShell>
      <PageHeader
        icon={ListTodo}
        eyebrow="Coursework"
        title="Tasks"
        description="Keep your coursework, deadlines, and study estimates in one place."
        actions={
          <>
            <GoogleImportButton source="google_classroom" />
            <Button onClick={openNew} aria-keyshortcuts="N">
              <Plus />
              Add task
              <Kbd aria-hidden className="ms-1 hidden border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground @2xl/dashboard:inline-flex">N</Kbd>
            </Button>
          </>
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

      <GoogleImportReminder source="google_classroom" />

      {/* ── Ledger: the controls and the list are one object ── */}
      <Card>
        <CardHeader className="flex flex-col items-stretch gap-3 px-1 pt-1 pb-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search leads, because it is what a long list is actually used with. */}
            <div className="relative min-w-0 flex-1 basis-full @2xl/dashboard:basis-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search tasks"
                aria-label="Search tasks by title or course"
                className="h-9 w-full ps-9 pe-9 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearch("");
                  }
                }}
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>

            <Select value={sort} onValueChange={(next) => next && setSort(next as SortKey)}>
              <SelectTrigger className="h-9" aria-label="Sort tasks">
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

            {/* The secondary filters live behind one control instead of
                spilling across two wrapped rows of half-labelled inputs. */}
            <Popover>
              <PopoverTrigger
                render={
                  <Button variant="outline" className="h-9">
                    <SlidersHorizontal />
                    Filters
                    {filterCount > 0 && (
                      <span className="ms-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-semibold text-primary-foreground">
                        {filterCount}
                      </span>
                    )}
                  </Button>
                }
              />
              <PopoverContent align="end" className="study-shell w-80 max-w-[calc(100vw-2rem)] p-4">
                <div className="space-y-3">
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
              <Button
                variant="link"
                size="xs"
                onClick={clearFilters}
                className="text-muted-foreground hover:text-foreground"
              >
                Clear all
              </Button>
            </div>
          )}

          {/* Tabs scroll on their own so the count stays visible at 390px. */}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Tabs
                value={status ?? ALL}
                onValueChange={(next) => setStatus(next === ALL || next == null ? null : (next as TaskStatus))}
              >
                <TabsList aria-label="Filter by status">
                  {STATUS_TABS.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value} className="flex-none px-2.5 text-[0.8125rem]">
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {isLoading
                ? "Loading…"
                : narrowed
                  ? `${visibleSorted.length} ${visibleSorted.length === 1 ? "task matches" : "tasks match"}`
                  : `${visible.length} ${visible.length === 1 ? "task" : "tasks"}`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="overflow-hidden p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={narrowed ? "No tasks match these filters" : "No tasks yet"}
              className="border-0"
              action={
                narrowed ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={openNew}><Plus className="size-4" />Add your first task</Button>
                )
              }
            >
              {narrowed
                ? "Try widening the filters above."
                : "Add your first task to see how it fits your week."}
            </EmptyState>
          ) : (
            groups.map((group) => (
              <section key={group.id ?? "all"} aria-label={group.id ? GROUP_LABELS[group.id] : "Tasks"}>
                {group.id && (
                  <h2
                    className={cn(
                      "flex items-center gap-2 border-b bg-muted/35 px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] @2xl/dashboard:px-6",
                      group.id === "overdue" ? "text-deficit" : "text-muted-foreground",
                    )}
                  >
                    {GROUP_LABELS[group.id]}
                    <span className="font-medium tabular-nums opacity-70">{group.tasks.length}</span>
                  </h2>
                )}
                <ul className="divide-y border-b last:border-b-0">
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      busy={busyTaskId === task.id}
                      disabled={busyTaskId !== null}
                      onEdit={() => {
                        setEditing(task);
                        setDialogOpen(true);
                      }}
                      onStart={() => void startTask(task)}
                      onFinish={() => setConfirmFinish(task)}
                      onDelete={() => requestDelete(task)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </CardContent>
      </Card>

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        onSaved={handleSaved}
      />

      {dialog}

      {/* SPEC §7.5: finishing early zeroes remaining work and drops future
          sessions, but keeps the time already recorded. */}
      <ConfirmDialog
        open={confirmFinish !== null}
        onOpenChange={(next) => !next && setConfirmFinish(null)}
        title={`Finish “${confirmFinish?.title ?? ""}” now?`}
        description="StudyFlow will treat this task as done, drop its upcoming sessions, and keep the time you have already logged."
        confirmLabel="Mark it finished"
        onConfirm={() => {
          const target = confirmFinish;
          if (!target) return;
          setConfirmFinish(null);
          finishTask(target);
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
    <Badge variant="outline" className="h-6 gap-1 rounded-md bg-card ps-2 pe-0.5 font-normal">
      <span className="max-w-40 truncate">{label}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onClear}
        aria-label={`Remove ${label} filter`}
        className="size-5 rounded-sm text-muted-foreground"
      >
        <X className="size-3" />
      </Button>
    </Badge>
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

/**
 * The status circle at the start of each row: empty to start a task, half
 * full to finish one early. It is the same control as the menu items, one
 * click closer.
 */
function StatusToggle({
  task,
  busy,
  disabled,
  onStart,
  onFinish,
}: {
  task: AcademicTask;
  busy: boolean;
  disabled: boolean;
  onStart: () => void;
  onFinish: () => void;
}) {
  const base =
    "relative flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-[transform,border-color,background-color] duration-150 ease-fluid";

  if (task.status === "Completed") {
    return (
      <span className={cn(base, "border-transparent bg-surplus text-background")} aria-label="Completed" role="img">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (task.status === "Overdue") {
    return (
      <span className={cn(base, "border-deficit text-deficit")} aria-label="Overdue" role="img">
        <AlertTriangle className="size-2.5" strokeWidth={2.5} />
      </span>
    );
  }

  const inProgress = task.status === "In Progress";
  return (
    <button
      type="button"
      onClick={inProgress ? onFinish : onStart}
      disabled={disabled}
      aria-label={inProgress ? `Mark “${task.title}” done` : `Start “${task.title}”`}
      title={inProgress ? "Mark done" : "Start"}
      className={cn(
        base,
        "group/toggle cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-90 disabled:cursor-default disabled:opacity-60",
        inProgress
          ? "border-primary hover-fine:bg-primary/10"
          : "border-muted-foreground/45 hover-fine:border-primary",
      )}
    >
      {busy ? (
        <Loader2 className="size-3 animate-spin text-primary" aria-hidden />
      ) : inProgress ? (
        <>
          <span
            aria-hidden
            className="size-2.5 rounded-full transition-opacity duration-150 group-hover/toggle:opacity-0"
            style={{ background: "conic-gradient(var(--primary) 0 50%, transparent 50% 100%)" }}
          />
          <Check aria-hidden className="absolute size-3 text-primary opacity-0 transition-opacity duration-150 group-hover/toggle:opacity-100" strokeWidth={3} />
        </>
      ) : (
        <Play aria-hidden className="size-2.5 translate-x-px fill-primary text-primary opacity-0 transition-opacity duration-150 group-hover/toggle:opacity-100" />
      )}
    </button>
  );
}

function TaskRow({
  task,
  busy,
  disabled = false,
  onEdit,
  onStart,
  onFinish,
  onDelete,
}: {
  task: AcademicTask;
  busy: boolean;
  disabled?: boolean;
  onEdit: () => void;
  onStart: () => void;
  onFinish: () => void;
  onDelete: () => void;
}) {
  const completed = task.status === "Completed";

  return (
    <li className="group relative flex items-center gap-3 py-3 pl-4 pr-2 transition-colors duration-150 hover-fine:bg-muted/40 compact:py-2 @2xl/dashboard:pl-6 @2xl/dashboard:pr-3">
      <StatusToggle task={task} busy={busy} disabled={busy || disabled} onStart={onStart} onFinish={onFinish} />

      <div className="min-w-0 flex-1">
        <Link
          href={`/tasks/${task.id}`}
          className={cn(
            "line-clamp-2 text-sm font-medium break-words underline-offset-4 hover:underline",
            completed && "text-muted-foreground line-through decoration-muted-foreground/40",
          )}
        >
          {task.title}
        </Link>
        {/* Only High priority earns a mark: Medium is the default and Low is
            not worth the reader's attention. */}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <CategoryTag category={task.category} />
          {task.priority === "High" && !completed && (
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-deficit">High</span>
          )}
          {task.course && (
            <span className="truncate text-xs text-muted-foreground">{task.course}</span>
          )}
          <span className="text-xs tabular-nums text-muted-foreground @3xl/dashboard:hidden">
            · {formatDuration(task.remainingDuration)} left
          </span>
        </div>
      </div>

      {/* SPEC §17.4: actual duration alongside estimated remaining. */}
      <div className="hidden w-40 shrink-0 flex-col gap-1.5 @3xl/dashboard:flex">
        <span className="flex justify-between gap-2 text-xs tabular-nums text-muted-foreground">
          <span>
            <span className="sr-only">Worked </span>
            {formatDuration(task.actualDuration)}
          </span>
          <span>
            <span className="sr-only">Left </span>
            {formatDuration(task.remainingDuration)} left
          </span>
        </span>
        <EffortBar worked={task.actualDuration} remaining={task.remainingDuration} />
      </div>

      <DueChip deadline={task.deadline} completed={completed} className="w-20 justify-end" />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={busy || disabled}
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
            <DropdownMenuItem onClick={onFinish}>Mark done</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function TasksPageWrapper() {
  const searchParams = useSearchParams();
  const searchKey = searchParams.get("search") ?? searchParams.get("q") ?? "";
  return <TasksContent key={searchKey} />;
}

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksPageWrapper />
    </Suspense>
  );
}
