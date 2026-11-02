import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { WeekLoad, WeekLoadLegend, type DayLoad } from "@/components/week-load";
import { fn } from "storybook/test";

const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const load: [number, number, number][] = [[180, 120, 0], [180, 60, 1], [180, 0, 0], [180, 180, 2], [180, 90, 0], [0, 0, 0], [240, 30, 1]];
const days: DayLoad[] = names.map((name, i) => ({ key: `2026-10-${12 + i}`, label: name.slice(0, 3), longLabel: `${name} ${12 + i} October`, dayNumber: String(12 + i), free: load[i][0], planned: load[i][1], deadlines: load[i][2], isToday: i === 4 }));

const meta = { title: "App/week-load", component: WeekLoad, args: { days, selectedKey: "2026-10-16", onSelect: fn() } } satisfies Meta<typeof WeekLoad>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Week: Story = { render: (args) => <div className="max-w-md space-y-3"><WeekLoad {...args} /><WeekLoadLegend /></div> };
export const Loading: Story = { ...Week, args: { loading: true } };
export const EmptyWeek: Story = { ...Week, args: { days: days.map((day) => ({ ...day, free: 0, planned: 0, deadlines: 0 })), selectedKey: undefined } };
