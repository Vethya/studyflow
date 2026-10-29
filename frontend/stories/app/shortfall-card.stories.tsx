import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ShortfallCard } from "@/components/shortfall-card";
import { task } from "../fixtures";

const meta = { title: "App/shortfall-card", component: ShortfallCard, parameters: { app: true }, args: { item: { task, deadline: new Date(task.deadline), requiredMinutes: 180, availableMinutes: 120, shortfallMinutes: 60, isOverloaded: true, relevantPeriods: [] } } } satisfies Meta<typeof ShortfallCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overload: Story = {};
