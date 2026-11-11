"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Command as CommandPrimitive } from "cmdk";
import { toast } from "sonner";
import {
  CalendarDays,
  ChartPie,
  ClipboardList,
  Clock,
  Clock3,
  Compass,
  CornerDownLeft,
  Keyboard,
  LayoutDashboard,
  Loader2,
  Monitor,
  Moon,
  MoonStar,
  Plus,
  Rows3,
  Search,
  Settings,
  Sparkles,
  Sun,
  type IconComponent,
} from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { CategoryTag } from "@/components/page-kit";
import { useApi } from "@/hooks/use-api";
import { tasks as tasksApi } from "@/lib/api";
import { taskSearchKey } from "@/lib/swr-keys";
import { applyThemeWithTransition } from "@/lib/theme";
import { setDensity, useDensity } from "@/lib/density";
import { restartOnboarding } from "@/lib/onboarding";
import { isMacPlatform, isShortcutBlocked } from "@/lib/shortcuts";
import { toggleFocusTimer, useFocusTimer } from "@/components/focus-timer";
import type { AcademicTask } from "@/types/task";

interface CommandMenuApi {
  openMenu: () => void;
  openNewTask: () => void;
  openShortcuts: () => void;
}

const noop = () => {};
const CommandMenuContext = createContext<CommandMenuApi>({
  openMenu: noop,
  openNewTask: noop,
  openShortcuts: noop,
});

export function useCommandMenu() {
  return useContext(CommandMenuContext);
}

/** `⌘` on Apple keyboards, `Ctrl` everywhere else. */
export function useModifierKey() {
  return useSyncExternalStore(
    () => noop,
    () => (isMacPlatform() ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

const PAGES: { href: string; label: string; icon: IconComponent }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/availability", label: "Availability", icon: Clock3 },
  { href: "/progress", label: "Progress", icon: ChartPie },
  { href: "/settings", label: "Settings", icon: Settings },
];

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "amoled", label: "AMOLED", icon: MoonStar },
  { value: "system", label: "Match my device", icon: Monitor },
] as const;

/**
 * The keyboard layer of the app: `⌘K` opens one menu that searches tasks and
 * runs every common action, and single-key shortcuts cover the rest.
 */
export function CommandMenuProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const api = useMemo<CommandMenuApi>(
    () => ({
      openMenu: () => setMenuOpen(true),
      openNewTask: () => {
        setMenuOpen(false);
        setTaskOpen(true);
      },
      openShortcuts: () => {
        setMenuOpen(false);
        setShortcutsOpen(true);
      },
    }),
    [],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setMenuOpen((open) => {
          if (open) return false;
          // Another dialog, including delete account, owns the keyboard.
          const dialog = document.querySelector(
            '[role="dialog"][data-open], [role="alertdialog"][data-open]',
          );
          return dialog === null;
        });
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isShortcutBlocked(event.target)) return;

      if (key === "/") {
        event.preventDefault();
        setMenuOpen(true);
      } else if (key === "n") {
        event.preventDefault();
        setTaskOpen(true);
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandMenuContext.Provider value={api}>
      {children}
      <CommandMenu open={menuOpen} onOpenChange={setMenuOpen} api={api} />
      <TaskFormDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        onSaved={(saved) => {
          toast.success("Task added", {
            description: saved.title,
            action: { label: "Open", onClick: () => router.push(`/tasks/${saved.id}`) },
          });
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </CommandMenuContext.Provider>
  );
}

function CommandMenu({
  open,
  onOpenChange,
  api,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: CommandMenuApi;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const density = useDensity();
  const focusStatus = useFocusTimer().status;
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(timer);
  }, [query]);

  const activeQuery = open && query.trim() ? debounced : "";
  const load = useCallback(
    (signal: AbortSignal) => tasksApi.searchTasks(activeQuery, signal, 8),
    [activeQuery],
  );
  const search = useApi(taskSearchKey(activeQuery), load);
  const matches: AcademicTask[] = activeQuery ? search.data ?? [] : [];
  const searching = query.trim() !== "" && (search.isLoading || activeQuery !== query.trim());

  // cmdk ranks by fuzzy score, which can put a page or action above the task
  // whose title was typed in full. Highlight that task so Enter opens it.
  const [highlighted, setHighlighted] = useState("");
  const exact = matches.find((task) => task.title.trim().toLowerCase() === query.trim().toLowerCase());
  const exactValue = exact ? `task-${exact.id}` : null;
  const [lastExact, setLastExact] = useState<string | null>(null);
  if (exactValue !== lastExact) {
    setLastExact(exactValue);
    if (exactValue) setHighlighted(exactValue);
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) setQuery("");
  }

  function run(action: () => void) {
    close(false);
    action();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl shadow-black/10 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <DialogDescription className="sr-only">
          Search your tasks, jump to a page, or run an action.
        </DialogDescription>
        {/* cmdk names its input through `label`; an aria-label on the input is overridden. */}
        <CommandPrimitive
          loop
          value={highlighted}
          onValueChange={setHighlighted}
          label="Search tasks, pages and actions"
          className="flex flex-col bg-popover text-popover-foreground"
        >
          <div className="flex items-center gap-3 border-b px-4">
            {searching ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search tasks, pages and actions…"
              className="h-13 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground"
            />
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </div>
          <CommandList className="max-h-[min(24rem,60dvh)] scroll-py-2 p-2">
            <CommandEmpty className="py-10 text-muted-foreground">
              {searching ? "Searching…" : `Nothing matches “${query.trim()}”.`}
            </CommandEmpty>

            {matches.length > 0 && (
              <CommandGroup heading="Tasks">
                {matches.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={`task-${task.id}`}
                    keywords={[task.title, task.course ?? ""]}
                    onSelect={() => run(() => router.push(`/tasks/${task.id}`))}
                    className="gap-3 py-2"
                  >
                    <ClipboardList className="text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    {task.course && (
                      <span className="hidden max-w-36 truncate text-xs text-muted-foreground sm:inline">
                        {task.course}
                      </span>
                    )}
                    <CategoryTag category={task.category} />
                  </CommandItem>
                ))}
                <CommandItem
                  value="all-task-results"
                  keywords={[query]}
                  onSelect={() =>
                    run(() => router.push(`/tasks?search=${encodeURIComponent(query.trim())}`))
                  }
                  className="gap-3 py-2 text-muted-foreground"
                >
                  <Search aria-hidden />
                  <span className="flex-1">See every match in Tasks</span>
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="Actions">
              <MenuItem icon={Plus} label="Add a task" shortcut={["N"]} onSelect={api.openNewTask} />
              <MenuItem
                icon={Sparkles}
                label="Plan my time"
                hint="Build sessions from your tasks"
                onSelect={() => run(() => router.push("/calendar"))}
              />
              <MenuItem
                icon={Clock3}
                label="Set my study hours"
                onSelect={() => run(() => router.push("/availability"))}
              />
              <MenuItem
                icon={Clock}
                label={
                  focusStatus === "running"
                    ? "Pause focus timer"
                    : focusStatus === "paused"
                      ? "Resume focus timer"
                      : "Start focus timer"
                }
                onSelect={() => run(toggleFocusTimer)}
              />
            </CommandGroup>

            <CommandSeparator className="my-1" />

            <CommandGroup heading="Go to">
              {PAGES.map((item) => (
                <MenuItem
                  key={item.href}
                  icon={item.icon}
                  label={item.label}
                  onSelect={() => run(() => router.push(item.href))}
                />
              ))}
            </CommandGroup>

            <CommandSeparator className="my-1" />

            <CommandGroup heading="Appearance">
              {THEMES.map((option) => (
                <MenuItem
                  key={option.value}
                  icon={option.icon}
                  label={`${option.label} theme`}
                  checked={(theme ?? "system") === option.value}
                  onSelect={() => run(() => applyThemeWithTransition(option.value, setTheme))}
                />
              ))}
              <MenuItem
                icon={Rows3}
                label={density === "compact" ? "Use comfortable spacing" : "Use compact spacing"}
                onSelect={() => run(() => setDensity(density === "compact" ? "comfortable" : "compact"))}
              />
            </CommandGroup>

            <CommandSeparator className="my-1" />

            <CommandGroup heading="Help">
              <MenuItem icon={Keyboard} label="Keyboard shortcuts" shortcut={["?"]} onSelect={api.openShortcuts} />
              <MenuItem
                icon={Compass}
                label="Show getting started"
                onSelect={() => run(restartOnboarding)}
              />
            </CommandGroup>
          </CommandList>
          <div className="hidden items-center gap-4 border-t bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground sm:flex">
            <span className="flex items-center gap-1.5">
              <KbdGroup><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup> to move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd><CornerDownLeft aria-hidden /></Kbd> to open
            </span>
            <span className="ms-auto">StudyFlow</span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

function MenuItem({
  icon: Icon,
  label,
  hint,
  shortcut,
  checked,
  onSelect,
}: {
  icon: IconComponent;
  label: string;
  hint?: string;
  shortcut?: string[];
  checked?: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={label} onSelect={onSelect} data-checked={checked ? "true" : undefined} className="gap-3 py-2">
      <Icon className="text-muted-foreground" aria-hidden />
      <span className="truncate">{label}</span>
      {hint && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{hint}</span>}
      {shortcut && (
        <CommandShortcut className="flex gap-0.5 tracking-normal">
          {shortcut.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </CommandShortcut>
      )}
    </CommandItem>
  );
}

const SHORTCUT_SECTIONS: { title: string; items: { label: string; keys: string[] }[] }[] = [
  {
    title: "Anywhere",
    items: [
      { label: "Open the command menu", keys: ["mod", "K"] },
      { label: "Search", keys: ["/"] },
      { label: "Add a task", keys: ["N"] },
      { label: "Show these shortcuts", keys: ["?"] },
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mod = useModifierKey();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <div>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="mt-1.5">
            Single keys work whenever you are not typing in a field.
          </DialogDescription>
        </div>
        <div className="grid gap-5">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{section.title}</h3>
              <ul className="divide-y rounded-xl border">
                {section.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>{item.label}</span>
                    <KbdGroup>
                      {item.keys.map((key) => (
                        <Kbd key={key}>{key === "mod" ? mod : key}</Kbd>
                      ))}
                    </KbdGroup>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
