import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart";


const meta = { title: "UI/Chart", component: ChartContainer, args: { config: { minutes: { label: "Minutes studied", color: "var(--primary)" } }, children: <></> } } satisfies Meta<typeof ChartContainer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WeeklyEffort: Story = { render: (args) => <ChartContainer {...args} className="h-64 w-full max-w-xl"><BarChart accessibilityLayer data={[{ day: "Mon", minutes: 60 }, { day: "Tue", minutes: 90 }, { day: "Wed", minutes: 45 }]}><CartesianGrid vertical={false} /><XAxis dataKey="day" /><ChartTooltip content={<ChartTooltipContent />} /><ChartLegend content={<ChartLegendContent />} /><Bar dataKey="minutes" fill="var(--color-minutes)" radius={4} /></BarChart></ChartContainer> };
