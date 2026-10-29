import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { WeekGrid, GridLegend } from "@/components/week-grid";
import { fn } from "storybook/test";

const meta = { title: "App/week-grid", component: WeekGrid, parameters: { app: true }, args: { columns: [{ key: "mon", label: "Mon", sublabel: "12" }, { key: "tue", label: "Tue", sublabel: "13", isToday: true }], hourStart: 8, hourEnd: 22, blocks: [{ id: "hours", columnKey: "mon", start: 1080, end: 1260, variant: "available" }, { id: "blocked", columnKey: "mon", start: 1140, end: 1200, variant: "blocked", title: "Office hours" }, { id: "session", columnKey: "tue", start: 1080, end: 1140, variant: "session", label: "Read paper", meta: "18:00–19:00", onSelect: fn() }] } } satisfies Meta<typeof WeekGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Weekly: Story = { render: (args) => <div className="space-y-4"><GridLegend showDeadline showSession proposalStates={["proposed", "missed", "delayed", "completed"]} /><WeekGrid {...args} /></div> };
export const Empty: Story = { ...Weekly, args: { blocks: [] } };
export const OutcomeStates: Story = { ...Weekly, args: { blocks: (["proposed", "missed", "delayed", "completed"] as const).map((tone, i) => ({ id: tone, columnKey: "tue", start: 540 + i * 90, end: 600 + i * 90, variant: "session", label: "Read paper", tone, badge: tone })) } };
