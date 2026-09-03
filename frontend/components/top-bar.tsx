"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { tasks as tasksApi } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { CATEGORY_CONFIG } from "@/lib/constants";

/**
 * The header holds one thing: finding a task.
 *
 * The account name, email, role badge and avatar used to sit in the top-right.
 * They were read-only — nothing there was clickable — and they occupied the
 * corner of every screen to tell the student something they already knew. The
 * account now lives at the foot of the sidebar as a real menu.
 *
 * The API has no text search, so this filters the task list already loaded in
 * the browser and jumps straight to a task. It is a finder, not a query — the
 * placeholder says so rather than promising a search the backend cannot do.
 */
export function TopBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const load = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const { data } = useApi(load);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (data ?? [])
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) || (t.course?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 6);
  }, [data, query]);

  return (
    <div className="flex flex-1 items-center">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a task"
          aria-label="Find a task by title or course"
          className="h-9 w-full rounded-lg border border-border bg-card ps-9 pe-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}

        {matches.length > 0 && (
          <ul className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border bg-popover py-1 shadow-lg">
            {matches.map((task) => (
              <li key={task.id}>
                <button
                  onClick={() => {
                    router.push(`/tasks/${task.id}`);
                    setQuery("");
                  }}
                  className="flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="truncate text-sm font-medium">{task.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {CATEGORY_CONFIG[task.category].label}
                    {task.course ? ` · ${task.course}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && matches.length === 0 && (
          <div className="absolute left-0 right-0 top-11 z-50 rounded-xl border bg-popover px-3 py-2.5 text-sm text-muted-foreground shadow-lg">
            No task matches “{query.trim()}”.
          </div>
        )}
      </div>
    </div>
  );
}
