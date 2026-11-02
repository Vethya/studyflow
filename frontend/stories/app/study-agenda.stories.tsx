import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StudyAgenda } from "@/components/study-agenda";
import { Button } from "@/components/ui/button";
import { preferences, task } from "../fixtures";
import { fn } from "storybook/test";

const columns = [{ key: "2026-10-16", label: "Fri", sublabel: "16", month: "Oct", isToday: true }, { key: "2026-10-17", label: "Sat", sublabel: "17", month: "Oct" }, { key: "2026-10-18", label: "Sun", sublabel: "18", month: "Oct" }];
const blocks = [
  { id: "hours-fri", columnKey: "2026-10-16", start: 1080, end: 1260, variant: "available" as const },
  { id: "session-fri", columnKey: "2026-10-16", start: 1080, end: 1140, variant: "session" as const, label: "Read cognitive science paper", meta: "18:00–19:00", onSelect: fn() },
  { id: "session-past", columnKey: "2026-10-16", start: 540, end: 600, variant: "session" as const, label: "Write lab report", meta: "09:00–10:00", attention: true, onSelect: fn() },
  { id: "session-sat", columnKey: "2026-10-17", start: 1080, end: 1170, variant: "session" as const, label: "Revise for midterm", meta: "18:00–19:30", settled: true, onSelect: fn() },
];

const meta = { title: "App/study-agenda", component: StudyAgenda, parameters: { app: true }, args: { columns, blocks, deadlines: new Map([["2026-10-17", [task]]]), timeZone: preferences.timezone, emptyAction: <Button>Plan my time</Button> } } satisfies Meta<typeof StudyAgenda>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Agenda: Story = {};
export const Empty: Story = { args: { blocks: [], deadlines: new Map() } };
