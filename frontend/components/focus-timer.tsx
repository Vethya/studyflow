"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ChevronDownIcon, Pause, Play, RotateCcw, Settings2, SkipForward, Timer } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/use-api";
import { tasks as tasksApi } from "@/lib/api";
import { SWR_KEYS } from "@/lib/swr-keys";
import { cn } from "@/lib/utils";
import {
  completePhase,
  formatClock,
  getFocusTimerState,
  getServerFocusTimerState,
  isPhaseOver,
  pauseTimer,
  PHASE_LABELS,
  phaseDurationMs,
  phaseProgress,
  remainingMs,
  resetTimer,
  setFocusTask,
  SETTING_LIMITS,
  skipPhase,
  startTimer,
  subscribeToFocusTimer,
  updateFocusTimer,
  updateSettings,
  type FocusSettings,
  type FocusTimerState,
} from "@/lib/focus-timer";
import {
  notificationsSupported,
  playChime,
  primeChime,
  requestNotificationPermission,
  showPhaseNotification,
} from "@/lib/focus-timer-alerts";

export function useFocusTimer(): FocusTimerState {
  return useSyncExternalStore(subscribeToFocusTimer, getFocusTimerState, getServerFocusTimerState);
}

/** Start, resume or pause from anywhere, e.g. the command menu. */
export function toggleFocusTimer(): void {
  const now = Date.now();
  if (getFocusTimerState().status === "running") {
    updateFocusTimer((state) => pauseTimer(state, now));
  } else {
    primeChime();
    updateFocusTimer((state) => startTimer(state, now));
  }
}

function startNow() {
  primeChime();
  updateFocusTimer((state) => startTimer(state, Date.now()));
}

function minutesText(ms: number) {
  const minutes = Math.round(ms / 60_000);
  return `${minutes}-minute`;
}

function phaseEndMessage(ended: FocusTimerState, next: FocusTimerState) {
  if (ended.phase === "focus") {
    const kind = next.phase === "longBreak" ? "long break" : "break";
    return {
      title: "Focus round done",
      description: `Time for a ${minutesText(phaseDurationMs(next.phase, next.settings))} ${kind}.`,
    };
  }
  return { title: "Break over", description: `Ready for focus round ${next.round}.` };
}

/** The running phase hit zero: advance it once, then chime, toast and maybe notify. */
function finishPhase(now: number) {
  const ended = getFocusTimerState();
  if (!isPhaseOver(ended, now)) return;
  const next = updateFocusTimer((state) => completePhase(state, now));
  const { title, description } = phaseEndMessage(ended, next);
  if (next.settings.sound) playChime();
  if (next.settings.notifications) showPhaseNotification(title, description);
  toast(title, {
    description,
    action:
      next.status === "running"
        ? undefined
        : { label: next.phase === "focus" ? "Start focus" : "Start break", onClick: startNow },
  });
}

function announcementFor(state: FocusTimerState) {
  const label = PHASE_LABELS[state.phase];
  if (state.status === "running") return `${label} started.`;
  if (state.status === "paused") return `${label} paused.`;
  return `${label} is ready to start.`;
}

const TITLE_PATTERN = /^\d{2,}:\d{2} · /;

/**
 * The top-bar timer. It is mounted once in the app shell, so it is also what
 * notices a phase ending, wherever the student is in the app.
 */
export function FocusTimer() {
  const state = useFocusTimer();
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const running = state.status === "running";

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      finishPhase(time);
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    // A sleeping tab skips intervals; catch up as soon as it is visible again.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running]);

  const clock = formatClock(remainingMs(state, now));
  const label = PHASE_LABELS[state.phase];

  const baseTitle = useRef<string | null>(null);
  useEffect(() => {
    if (!running) return;
    // Pages set their own titles on navigation; remember whichever is current.
    if (!TITLE_PATTERN.test(document.title)) baseTitle.current = document.title;
    document.title = `${clock} · ${label} — StudyFlow`;
  }, [running, clock, label]);
  useEffect(() => {
    if (!running) return;
    return () => {
      if (baseTitle.current !== null) document.title = baseTitle.current;
    };
  }, [running]);

  const key = `${state.phase}|${state.status}`;
  const [lastKey, setLastKey] = useState(key);
  const [announcement, setAnnouncement] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setAnnouncement(announcementFor(state));
  }

  const active = state.status !== "idle";
  const triggerLabel = active
    ? `Focus timer: ${label}, ${clock} left${state.status === "paused" ? ", paused" : ""}`
    : "Focus timer";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size={active ? "sm" : "icon"}
              aria-label={triggerLabel}
              title={triggerLabel}
              data-tour="focus-timer"
              className={cn(
                "shrink-0 rounded-lg text-muted-foreground hover:text-foreground",
                active && "h-9 gap-1.5 px-2.5",
              )}
            />
          }
        >
          <TimerGlyph className="size-[1.125rem]" />
          {active && (
            <span
              data-testid="focus-timer-pill"
              className={cn(
                "flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
                state.phase === "focus" ? "bg-primary/10 text-primary" : "bg-surplus/15 text-surplus",
                state.status === "paused" && "bg-muted text-muted-foreground",
              )}
            >
              {running && <span aria-hidden className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />}
              {clock}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-80 max-w-[calc(100vw-1.5rem)] gap-0 rounded-xl border bg-card p-0 shadow-xs ring-0"
        >
          <FocusTimerPanel state={state} clock={clock} now={now} />
        </PopoverContent>
      </Popover>
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    </>
  );
}

function TimerGlyph({ className }: { className?: string }) {
  return <Timer className={className} />;
}

const RING_RADIUS = 76;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function FocusTimerPanel({ state, clock, now }: { state: FocusTimerState; clock: string; now: number }) {
  const rounds = state.settings.roundsBeforeLongBreak;
  const filled = state.phase === "focus" ? state.round - 1 : state.round;
  const progress = phaseProgress(state, now);
  const isFocus = state.phase === "focus";
  const primaryLabel = state.status === "running" ? "Pause" : state.status === "paused" ? "Resume" : "Start";

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <PopoverTitle className="text-sm font-semibold">Focus timer</PopoverTitle>
        <span className="text-xs text-muted-foreground tabular-nums">Round {state.round} of {rounds}</span>
      </div>

      <div className="flex flex-col items-center gap-4 px-4 pt-3 pb-4">
        <div className="relative size-44">
          <svg viewBox="0 0 176 176" className="size-full -rotate-90" aria-hidden>
            <circle cx="88" cy="88" r={RING_RADIUS} fill="none" strokeWidth="8" className="stroke-muted" />
            <circle
              data-testid="focus-timer-ring"
              cx="88"
              cy="88"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - progress)}
              className={cn(
                "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear",
                isFocus ? "stroke-primary" : "stroke-surplus",
              )}
            />
          </svg>
          <div
            role="timer"
            aria-label={`${PHASE_LABELS[state.phase]}, ${clock} left`}
            className="absolute inset-0 flex flex-col items-center justify-center"
          >
            <span className="text-4xl font-semibold tracking-tight tabular-nums">{clock}</span>
            <span className={cn("mt-1 text-xs font-medium", isFocus ? "text-primary" : "text-surplus")}>
              {PHASE_LABELS[state.phase]}
              {state.status === "paused" && " · Paused"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Reset timer"
            title="Reset timer"
            className="rounded-full"
            onClick={() => updateFocusTimer(resetTimer)}
          >
            <RotateCcw />
          </Button>
          <Button size="lg" className="min-w-28 rounded-full" onClick={toggleFocusTimer} aria-label={`${primaryLabel} ${PHASE_LABELS[state.phase].toLowerCase()}`}>
            {state.status === "running" ? (
              <Pause />
            ) : (
              <Play />
            )}
            {primaryLabel}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Skip to next phase"
            title="Skip to next phase"
            className="rounded-full"
            onClick={() => updateFocusTimer((current) => skipPhase(current, Date.now()))}
          >
            <SkipForward />
          </Button>
        </div>

        <div role="img" aria-label={`${filled} of ${rounds} focus rounds done`} className="flex items-center gap-1.5">
          {Array.from({ length: rounds }, (_, index) => (
            <span
              key={index}
              data-filled={index < filled || undefined}
              className={cn("size-2 rounded-full", index < filled ? "bg-primary" : "bg-muted")}
            />
          ))}
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <TaskPicker state={state} />
      </div>
      <div className="border-t">
        <TimerSettings settings={state.settings} />
      </div>
    </div>
  );
}

const NO_TASK = "";

function TaskPicker({ state }: { state: FocusTimerState }) {
  const id = useId();
  const loadTasks = useCallback((signal: AbortSignal) => tasksApi.listTasks({}, signal), []);
  const tasks = useApi(SWR_KEYS.tasks, loadTasks);
  const open = (tasks.data ?? []).filter((task) => task.status !== "Completed");
  const missing = state.taskId !== null && !open.some((task) => task.id === state.taskId);

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">Focusing on</label>
      <select
        id={id}
        value={state.taskId ?? NO_TASK}
        onChange={(event) => {
          const task = open.find((item) => item.id === event.target.value);
          updateFocusTimer((current) => setFocusTask(current, task ? { id: task.id, title: task.title } : null));
        }}
        className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
      >
        <option value={NO_TASK}>Nothing in particular</option>
        {missing && <option value={state.taskId!}>{state.taskTitle ?? "Earlier task"}</option>}
        {open.map((task) => (
          <option key={task.id} value={task.id}>{task.title}</option>
        ))}
      </select>
      {tasks.isLoading && <p className="text-xs text-muted-foreground">Loading your tasks…</p>}
    </div>
  );
}

const NUMBER_FIELDS: { key: keyof typeof SETTING_LIMITS; label: string }[] = [
  { key: "focusMinutes", label: "Focus (min)" },
  { key: "shortBreakMinutes", label: "Short break (min)" },
  { key: "longBreakMinutes", label: "Long break (min)" },
  { key: "roundsBeforeLongBreak", label: "Rounds before long break" },
];

function TimerSettings({ settings }: { settings: FocusSettings }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const change = (patch: Partial<FocusSettings>) => updateFocusTimer((state) => updateSettings(state, patch));

  async function toggleNotifications(checked: boolean) {
    if (!checked) {
      change({ notifications: false });
      return;
    }
    if (await requestNotificationPermission()) {
      change({ notifications: true });
    } else {
      toast.error("Notifications are blocked", {
        description: "Allow notifications for StudyFlow in your browser settings to use them.",
      });
    }
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-settings`}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:bg-accent"
      >
        <Settings2 className="size-3.5" />
        <span className="flex-1 text-start">Timer settings</span>
        <ChevronDownIcon className={cn("size-3.5 motion-safe:transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div id={`${id}-settings`} className="grid gap-3 px-4 pb-4">
          <div className="grid grid-cols-2 gap-2.5">
            {NUMBER_FIELDS.map(({ key, label }) => (
              <NumberSetting
                key={key}
                label={label}
                limits={SETTING_LIMITS[key]}
                value={settings[key]}
                onCommit={(value) => change({ [key]: value })}
              />
            ))}
          </div>
          <SettingSwitch label="Start the next phase automatically" checked={settings.autoStart} onChange={(autoStart) => change({ autoStart })} />
          <SettingSwitch label="Play a chime when a phase ends" checked={settings.sound} onChange={(sound) => change({ sound })} />
          {notificationsSupported() && (
            <SettingSwitch
              label="Notify me when the tab is in the background"
              checked={settings.notifications}
              onChange={(checked) => void toggleNotifications(checked)}
            />
          )}
        </div>
      )}
    </>
  );
}

/** Keeps the typed text while it is invalid (e.g. empty), and snaps back to the saved value on blur. */
function NumberSetting({
  label,
  limits,
  value,
  onCommit,
}: {
  label: string;
  limits: { min: number; max: number };
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [saved, setSaved] = useState(value);
  if (value !== saved) {
    setSaved(value);
    setDraft(String(value));
  }
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        inputMode="numeric"
        min={limits.min}
        max={limits.max}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onCommit(next);
        }}
        onBlur={() => setDraft(String(value))}
        className="h-8 text-foreground tabular-nums"
      />
    </label>
  );
}

function SettingSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      <Switch size="sm" checked={checked} onCheckedChange={(value) => onChange(value)} />
    </label>
  );
}
