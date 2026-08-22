import type { Category, Priority, TaskStatus } from "@/types";

// ─── Category config ────────────────────────────────────────────
export const CATEGORY_CONFIG: Record<Category, { label: string; color: string; bg: string }> = {
  Assignment:         { label: "Assignment",       color: "text-indigo-700",  bg: "bg-indigo-50" },
  Reading:            { label: "Reading",          color: "text-teal-700",    bg: "bg-teal-50" },
  "Exam Preparation": { label: "Exam Prep",        color: "text-rose-700",    bg: "bg-rose-50" },
  Project:            { label: "Project",          color: "text-amber-700",   bg: "bg-amber-50" },
  "Research/Writing": { label: "Research/Writing", color: "text-sky-700",     bg: "bg-sky-50" },
  Other:              { label: "Other",            color: "text-zinc-600",    bg: "bg-zinc-100" },
};

// ─── Priority config ────────────────────────────────────────────
export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string }> = {
  Low:    { label: "Low",    color: "text-zinc-600",   bg: "bg-zinc-100" },
  Medium: { label: "Medium", color: "text-blue-700",   bg: "bg-blue-50" },
  High:   { label: "High",   color: "text-red-700",    bg: "bg-red-50" },
};

// ─── Status config ──────────────────────────────────────────────
export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string; dotColor: string }> = {
  "Not Started":  { label: "Not Started",  color: "text-zinc-600",   bg: "bg-zinc-100",   dotColor: "bg-zinc-400" },
  "In Progress":  { label: "In Progress",  color: "text-blue-700",   bg: "bg-blue-50",    dotColor: "bg-blue-500" },
  Completed:      { label: "Completed",    color: "text-green-700",  bg: "bg-green-50",   dotColor: "bg-green-500" },
  Overdue:        { label: "Overdue",      color: "text-red-700",    bg: "bg-red-50",     dotColor: "bg-red-500" },
};

// ─── Session outcome colors ─────────────────────────────────────
export const OUTCOME_CONFIG = {
  Completed: { label: "Completed", color: "text-green-700", bg: "bg-green-50", icon: "check-circle" },
  Delayed:   { label: "Delayed",   color: "text-amber-700", bg: "bg-amber-50", icon: "clock" },
  Missed:    { label: "Missed",    color: "text-red-700",   bg: "bg-red-50",   icon: "x-circle" },
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
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDurationLong(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
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
