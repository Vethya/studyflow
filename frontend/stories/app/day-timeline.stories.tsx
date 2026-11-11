import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DayTimeline } from "@/components/day-timeline";
import { NOW, preferences, task } from "../fixtures";
import type { StudySession } from "@/types/session";
import { fn } from "storybook/test";

const session = (id: string, start: string, end: string, extra: Partial<StudySession> = {}): StudySession => ({ id, taskId: task.id, taskTitle: task.title, category: task.category, startTime: start, endTime: end, plannedDuration: 60, isAwaitingOutcome: false, ...extra });
const today = [
  session("done", "2026-10-16T01:00:00Z", "2026-10-16T02:00:00Z", { outcome: "Completed", actualDuration: 60 }),
  session("waiting", "2026-10-16T03:00:00Z", "2026-10-16T04:00:00Z", { taskTitle: "Write lab report", category: "Assignment", isAwaitingOutcome: true }),
  session("now", "2026-10-16T04:30:00Z", "2026-10-16T05:30:00Z"),
  session("next", "2026-10-16T11:00:00Z", "2026-10-16T12:00:00Z", { taskTitle: "Revise for midterm", category: "Exam Preparation" }),
];

const meta = { title: "App/day-timeline", component: DayTimeline, parameters: { app: true }, args: { sessions: today, now: new Date(NOW), timeZone: preferences.timezone, hasPlan: true, onRecord: fn() } } satisfies Meta<typeof DayTimeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Today: Story = {};
export const NothingToday: Story = { args: { sessions: [] } };
export const NoPlan: Story = { args: { sessions: [], hasPlan: false } };
export const Loading: Story = { args: { isLoading: true } };
