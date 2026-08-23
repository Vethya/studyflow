"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { tasks as tasksApi } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";
import { CATEGORY_CONFIG } from "@/lib/constants";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0])
    .toUpperCase();
}

/**
 * The API has no text search, so this filters the task list already loaded in
 * the browser and jumps straight to a task. It is a finder, not a query — the
 * placeholder says so rather than promising a search the backend cannot do.
 */
export function TopBar() {
  const router = useRouter();
  const { account } = useSession();
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
    <div className="flex flex-1 items-center gap-4">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a task"
          aria-label="Find a task by title or course"
          className="h-9 w-full rounded-full border border-border bg-card pl-9 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring"
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

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="flex items-center justify-end gap-2 text-sm font-medium leading-tight">
            <span className="truncate">{account?.name ?? "…"}</span>
            <span
              className={cn(
                "rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium",
                "text-secondary-foreground",
              )}
            >
              Student
            </span>
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {account?.email ?? ""}
          </p>
        </div>
        <Avatar className="size-9">
          <AvatarFallback className="bg-primary font-mono text-xs font-medium text-primary-foreground">
            {account ? initials(account.name) : "··"}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
