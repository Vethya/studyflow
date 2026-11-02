/**
 * Pomodoro focus timer state. Everything here is pure except the small store
 * at the bottom, which keeps one shared timer in memory and mirrors it to
 * localStorage so it survives navigation, refreshes and sleeping tabs.
 *
 * A running timer is stored as the moment it ends, never as a ticking count,
 * so the remaining time is always `endsAt - now` however long the page slept.
 */

export type FocusPhase = "focus" | "shortBreak" | "longBreak";
export type FocusStatus = "idle" | "running" | "paused";

export interface FocusSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  roundsBeforeLongBreak: number;
  autoStart: boolean;
  sound: boolean;
  notifications: boolean;
}

export interface FocusTimerState {
  phase: FocusPhase;
  status: FocusStatus;
  /** Epoch ms when the running phase ends; null unless running. */
  endsAt: number | null;
  /** Time left when paused; null unless paused. */
  pausedRemainingMs: number | null;
  /** 1-based focus round within the current cycle. */
  round: number;
  taskId: string | null;
  taskTitle: string | null;
  settings: FocusSettings;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
  autoStart: false,
  sound: true,
  notifications: false,
};

export const DEFAULT_FOCUS_STATE: FocusTimerState = {
  phase: "focus",
  status: "idle",
  endsAt: null,
  pausedRemainingMs: null,
  round: 1,
  taskId: null,
  taskTitle: null,
  settings: DEFAULT_FOCUS_SETTINGS,
};

export const SETTING_LIMITS = {
  focusMinutes: { min: 1, max: 180 },
  shortBreakMinutes: { min: 1, max: 60 },
  longBreakMinutes: { min: 1, max: 90 },
  roundsBeforeLongBreak: { min: 1, max: 12 },
} as const;

type NumericSetting = keyof typeof SETTING_LIMITS;

export const PHASE_LABELS: Record<FocusPhase, string> = {
  focus: "Focus",
  shortBreak: "Short break",
  longBreak: "Long break",
};

const MINUTE = 60_000;

function clampSetting(key: NumericSetting, value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const { min, max } = SETTING_LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function phaseDurationMs(phase: FocusPhase, settings: FocusSettings): number {
  const minutes =
    phase === "focus"
      ? settings.focusMinutes
      : phase === "shortBreak"
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;
  return minutes * MINUTE;
}

export function remainingMs(state: FocusTimerState, now: number): number {
  if (state.status === "running" && state.endsAt !== null) return Math.max(0, state.endsAt - now);
  if (state.status === "paused" && state.pausedRemainingMs !== null) return state.pausedRemainingMs;
  return phaseDurationMs(state.phase, state.settings);
}

/** Share of the current phase already used, 0 to 1. */
export function phaseProgress(state: FocusTimerState, now: number): number {
  const total = phaseDurationMs(state.phase, state.settings);
  return Math.min(1, Math.max(0, 1 - remainingMs(state, now) / total));
}

export function isPhaseOver(state: FocusTimerState, now: number): boolean {
  return state.status === "running" && state.endsAt !== null && now >= state.endsAt;
}

/** `mm:ss`, rounding up so a timer never shows 00:00 while time is left. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function startTimer(state: FocusTimerState, now: number): FocusTimerState {
  if (state.status === "running") return state;
  return {
    ...state,
    status: "running",
    endsAt: now + remainingMs(state, now),
    pausedRemainingMs: null,
  };
}

export function pauseTimer(state: FocusTimerState, now: number): FocusTimerState {
  if (state.status !== "running") return state;
  return { ...state, status: "paused", endsAt: null, pausedRemainingMs: remainingMs(state, now) };
}

/** Back to the first focus round, keeping settings and the chosen task. */
export function resetTimer(state: FocusTimerState): FocusTimerState {
  return {
    ...DEFAULT_FOCUS_STATE,
    taskId: state.taskId,
    taskTitle: state.taskTitle,
    settings: state.settings,
  };
}

export function nextPhase(state: FocusTimerState): { phase: FocusPhase; round: number } {
  const rounds = state.settings.roundsBeforeLongBreak;
  if (state.phase === "focus") {
    return { phase: state.round >= rounds ? "longBreak" : "shortBreak", round: state.round };
  }
  if (state.phase === "longBreak") return { phase: "focus", round: 1 };
  return { phase: "focus", round: Math.min(rounds, state.round + 1) };
}

function enterPhase(state: FocusTimerState, now: number, run: boolean): FocusTimerState {
  const next = { ...state, ...nextPhase(state), status: "idle" as FocusStatus, endsAt: null, pausedRemainingMs: null };
  return run ? startTimer(next, now) : next;
}

/** The running phase reached zero: move on, starting the next one only if auto-start is on. */
export function completePhase(state: FocusTimerState, now: number): FocusTimerState {
  return enterPhase(state, now, state.settings.autoStart);
}

/** Jump to the next phase; a running timer keeps running. */
export function skipPhase(state: FocusTimerState, now: number): FocusTimerState {
  return enterPhase(state, now, state.status === "running");
}

export function updateSettings(state: FocusTimerState, patch: Partial<FocusSettings>): FocusTimerState {
  const settings = sanitizeSettings({ ...state.settings, ...patch });
  return { ...state, settings, round: Math.min(state.round, settings.roundsBeforeLongBreak) };
}

export function setFocusTask(state: FocusTimerState, task: { id: string; title: string } | null): FocusTimerState {
  return { ...state, taskId: task?.id ?? null, taskTitle: task?.title ?? null };
}

function sanitizeSettings(raw: unknown): FocusSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (key: "autoStart" | "sound" | "notifications") =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULT_FOCUS_SETTINGS[key];
  const num = (key: NumericSetting) => clampSetting(key, value[key], DEFAULT_FOCUS_SETTINGS[key]);
  return {
    focusMinutes: num("focusMinutes"),
    shortBreakMinutes: num("shortBreakMinutes"),
    longBreakMinutes: num("longBreakMinutes"),
    roundsBeforeLongBreak: num("roundsBeforeLongBreak"),
    autoStart: bool("autoStart"),
    sound: bool("sound"),
    notifications: bool("notifications"),
  };
}

const PHASES: FocusPhase[] = ["focus", "shortBreak", "longBreak"];
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/** Reads stored JSON defensively: anything malformed falls back to a fresh timer. */
export function parseFocusState(raw: string | null): FocusTimerState {
  if (!raw) return DEFAULT_FOCUS_STATE;
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_FOCUS_STATE;
    value = parsed as Record<string, unknown>;
  } catch {
    return DEFAULT_FOCUS_STATE;
  }
  const settings = sanitizeSettings(value.settings);
  const phase = PHASES.includes(value.phase as FocusPhase) ? (value.phase as FocusPhase) : "focus";
  const round = finite(value.round)
    ? Math.min(settings.roundsBeforeLongBreak, Math.max(1, Math.round(value.round)))
    : 1;
  const taskId = text(value.taskId);
  const base: FocusTimerState = {
    ...DEFAULT_FOCUS_STATE,
    phase,
    round,
    taskId,
    taskTitle: taskId ? text(value.taskTitle) : null,
    settings,
  };
  if (value.status === "running" && finite(value.endsAt)) {
    return { ...base, status: "running", endsAt: value.endsAt };
  }
  if (value.status === "paused" && finite(value.pausedRemainingMs) && value.pausedRemainingMs >= 0) {
    return { ...base, status: "paused", pausedRemainingMs: value.pausedRemainingMs };
  }
  return base;
}

export const FOCUS_TIMER_STORAGE_KEY = "studyflow:focus-timer";

let current: FocusTimerState | null = null;
const listeners = new Set<() => void>();

function load(): FocusTimerState {
  try {
    return parseFocusState(window.localStorage.getItem(FOCUS_TIMER_STORAGE_KEY));
  } catch {
    return DEFAULT_FOCUS_STATE;
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

/** Another tab changed the timer; adopt its state so both tabs agree. */
function onStorage(event: StorageEvent) {
  if (event.key !== FOCUS_TIMER_STORAGE_KEY && event.key !== null) return;
  current = load();
  emit();
}

export function subscribeToFocusTimer(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getFocusTimerState(): FocusTimerState {
  current ??= load();
  return current;
}

export const getServerFocusTimerState = () => DEFAULT_FOCUS_STATE;

export function updateFocusTimer(update: (state: FocusTimerState) => FocusTimerState): FocusTimerState {
  const previous = getFocusTimerState();
  const next = update(previous);
  if (next === previous) return previous;
  current = next;
  try {
    window.localStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The in-memory state keeps the timer working for this session.
  }
  emit();
  return next;
}

/** Test helper: forget the in-memory copy so the next read comes from storage. */
export function resetFocusTimerStore(): void {
  current = null;
}

/** Sign-out and account deletion drop the timer, including its task title. */
export function clearFocusTimer(): void {
  current = DEFAULT_FOCUS_STATE;
  try {
    window.localStorage.removeItem(FOCUS_TIMER_STORAGE_KEY);
  } catch {
    // The in-memory timer is already back to its default.
  }
  emit();
}
