import type { GridBlock, GridColumn } from "@/components/week-grid";
import type { DayLoad } from "@/components/week-load";

// A fixed week keeps the server render and the hydrated previews identical.
export const demoCapacity = { available: 840, committed: 1080 };

export const demoColumns: GridColumn[] = [
  { key: "2026-09-28", label: "Mon" },
  { key: "2026-09-29", label: "Tue" },
  { key: "2026-09-30", label: "Wed" },
  { key: "2026-10-01", label: "Thu" },
  { key: "2026-10-02", label: "Fri" },
];

export const demoBlocks: GridBlock[] = [
  { id: "mon-hours", columnKey: "2026-09-28", start: 540, end: 720, variant: "available" },
  { id: "tue-hours", columnKey: "2026-09-29", start: 780, end: 1020, variant: "available" },
  { id: "wed-hours", columnKey: "2026-09-30", start: 540, end: 720, variant: "available" },
  { id: "thu-hours", columnKey: "2026-10-01", start: 540, end: 720, variant: "available" },
  { id: "fri-hours", columnKey: "2026-10-02", start: 780, end: 1020, variant: "available" },
  { id: "midterm", columnKey: "2026-09-30", start: 540, end: 720, variant: "blocked", title: "Midterm", label: "Midterm" },
  { id: "reading", columnKey: "2026-09-28", start: 540, end: 660, variant: "session", title: "History reading", label: "Reading", meta: "9–11am" },
  { id: "algebra", columnKey: "2026-09-29", start: 780, end: 960, variant: "session", title: "Linear Algebra problem set", label: "Algebra", meta: "1–4pm" },
];

export const demoDays: DayLoad[] = [
  { key: "2026-09-28", label: "Mon", longLabel: "Monday 28 September", dayNumber: "28", free: 180, planned: 180, deadlines: 0, isToday: false },
  { key: "2026-09-29", label: "Tue", longLabel: "Tuesday 29 September", dayNumber: "29", free: 240, planned: 300, deadlines: 1, isToday: false },
  { key: "2026-09-30", label: "Wed", longLabel: "Wednesday 30 September", dayNumber: "30", free: 0, planned: 0, deadlines: 0, isToday: false },
  { key: "2026-10-01", label: "Thu", longLabel: "Thursday 1 October", dayNumber: "1", free: 180, planned: 240, deadlines: 1, isToday: false },
  { key: "2026-10-02", label: "Fri", longLabel: "Friday 2 October", dayNumber: "2", free: 240, planned: 360, deadlines: 2, isToday: false },
  { key: "2026-10-03", label: "Sat", longLabel: "Saturday 3 October", dayNumber: "3", free: 0, planned: 0, deadlines: 0, isToday: false },
  { key: "2026-10-04", label: "Sun", longLabel: "Sunday 4 October", dayNumber: "4", free: 0, planned: 0, deadlines: 0, isToday: false },
];

export const demoTasks = [
  { name: "Chapter notes", course: "History", due: "Tue 29 Sep", estimate: "3h" },
  { name: "Essay draft", course: "Literature", due: "Thu 1 Oct", estimate: "5h" },
  { name: "Problem set", course: "Linear Algebra", due: "Fri 2 Oct", estimate: "6h" },
  { name: "Lab report", course: "Physics", due: "Fri 2 Oct", estimate: "4h" },
];
