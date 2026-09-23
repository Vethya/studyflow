"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { tasks as tasksApi } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { CATEGORY_CONFIG } from "@/lib/constants";
import { taskSearchKey } from "@/lib/swr-keys";

/**
 * The header holds one thing: finding a task.
 *
 * Task search queries the backend (/tasks?query=...&limit=6) with debouncing,
 * matching against task title and course server-side without preloading all tasks.
 */
export function TopBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmedQuery = query.trim();
  const activeQuery = trimmedQuery ? debouncedQuery : "";
  const searchKey = taskSearchKey(activeQuery);
  const load = useCallback(
    (signal: AbortSignal) => tasksApi.searchTasks(activeQuery, signal, 6),
    [activeQuery],
  );
  const { data, isLoading } = useApi(searchKey, load);

  const matches = useMemo(
    () => (activeQuery ? data ?? [] : []),
    [activeQuery, data],
  );

  const isPending = trimmedQuery !== "" && (isLoading || activeQuery !== trimmedQuery);

  return (
    <div className="flex flex-1 items-center">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
            }
          }}
          placeholder="Find a task"
          aria-label="Find a task by title or course"
          className="h-9 w-full rounded-lg border border-border bg-card ps-9 pe-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-all duration-150 animate-in fade-in-0 zoom-in-75"
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <X className="size-3.5" />
            )}
          </button>
        )}

        {matches.length > 0 && (
          <ul className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border bg-popover py-1 shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out">
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
        {query.trim() && !isPending && matches.length === 0 && (
          <div className="absolute left-0 right-0 top-11 z-50 rounded-xl border bg-popover px-3 py-2.5 text-sm text-muted-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out">
            No task matches “{query.trim()}”.
          </div>
        )}
      </div>
    </div>
  );
}

