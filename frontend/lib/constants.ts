import type { Category, Priority, TaskStatus } from "@/types";

/*
 * Colour policy
 * ─────────────
 * Teal (`surplus`) and orange (`deficit`) are the only saturated colours in the
 * product: they mean "you have room" and "you are over", and nothing else.
 *
 * Categories are marked like highlighter tabs in a notebook: a small coloured
 * dot on a faint wash of the same ink, with the label in regular text. The
 * hues are muted (`--cat-*` in globals.css) so a task list never looks more
 * urgent than the capacity warnings next to it.
 */

// ─── Category config ────────────────────────────────────────────
const NEUTRAL_CHIP = { color: "text-muted-foreground", bg: "bg-muted" } as const;

export const CATEGORY_CONFIG: Record<
  Category,
  { label: string; color: string; bg: string; dot: string }
> = {
  Assignment:         { label: "Assignment", color: "text-foreground", bg: "bg-cat-assignment/12", dot: "bg-cat-assignment" },
  Reading:            { label: "Reading",    color: "text-foreground", bg: "bg-cat-reading/12",    dot: "bg-cat-reading" },
  "Exam Preparation": { label: "Exam prep",  color: "text-foreground", bg: "bg-cat-exam/12",       dot: "bg-cat-exam" },
  Project:            { label: "Project",    color: "text-foreground", bg: "bg-cat-project/12",    dot: "bg-cat-project" },
  "Research/Writing": { label: "Research",   color: "text-foreground", bg: "bg-cat-research/14",   dot: "bg-cat-research" },
  Other:              { label: "Other",      color: "text-foreground", bg: "bg-cat-other/14",      dot: "bg-cat-other" },
};

// ─── Priority config ────────────────────────────────────────────
// Only High is ever shown; Medium is the default and Low is not worth a chip.
export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string }> = {
  Low:    { label: "Low",    ...NEUTRAL_CHIP },
  Medium: { label: "Medium", ...NEUTRAL_CHIP },
  High:   { label: "High",   color: "text-foreground", bg: "bg-secondary" },
};

// ─── Status config ──────────────────────────────────────────────
// Overdue is a capacity failure, so it earns the deficit colour. Completed
// earns surplus. The two neutral states stay in ink.
export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string; dotColor: string }> = {
  "Not Started":  { label: "Not started",  color: "text-muted-foreground", bg: "bg-muted",         dotColor: "bg-muted-foreground/40" },
  "In Progress":  { label: "In progress",  color: "text-foreground",       bg: "bg-secondary",     dotColor: "bg-foreground" },
  Completed:      { label: "Completed",    color: "text-surplus",          bg: "bg-surplus-soft",  dotColor: "bg-surplus" },
  Overdue:        { label: "Overdue",      color: "text-deficit",          bg: "bg-deficit-soft",  dotColor: "bg-deficit" },
};

// ─── Session outcome colors ─────────────────────────────────────
export const OUTCOME_CONFIG = {
  Completed: { label: "Completed", color: "text-surplus",          bg: "bg-surplus-soft", icon: "check-circle" },
  Delayed:   { label: "Delayed",   color: "text-muted-foreground", bg: "bg-muted",        icon: "clock" },
  Missed:    { label: "Missed",    color: "text-deficit",          bg: "bg-deficit-soft", icon: "x-circle" },
} as const;

// ─── Navigation items ───────────────────────────────────────────
export const NAV_ITEMS = [
  {
    section: "PLANNING",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
      { label: "Calendar",  href: "/calendar",  icon: "Calendar" },
      { label: "Tasks",     href: "/tasks",     icon: "ListTodo" },
    ],
  },
  {
    section: "REVIEW",
    items: [
      { label: "Availability", href: "/availability", icon: "Clock" },
      { label: "Progress",     href: "/progress",     icon: "TrendingUp" },
    ],
  },
  {
    section: "ACCOUNT",
    items: [
      { label: "Settings", href: "/settings", icon: "Settings" },
    ],
  },
];

// ─── Duration helpers ───────────────────────────────────────────
/**
 * Durations are always whole minutes (SPEC §9.1).
 *
 * The input is rounded rather than trusted: capacity is derived by subtracting
 * timestamps, and any interval measured from "now" carries seconds and
 * milliseconds into the result. Without this, a perfectly ordinary figure
 * renders as "2h 35.35986666666668m".
 */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDurationLong(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

// ─── Weekday names ──────────────────────────────────────────────
// Indexed the way `AvailabilityWindow.dayOfWeek` is: 0 = Sunday.
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
