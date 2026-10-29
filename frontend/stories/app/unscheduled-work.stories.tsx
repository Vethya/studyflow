import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { UnscheduledWorkList } from "@/components/unscheduled-work-list";
import { task } from "../fixtures";

const meta = { title: "App/unscheduled-work", component: UnscheduledWorkList, parameters: { app: true }, args: { items: [{ taskId: task.id, taskTitle: task.title, remainingMinutes: 60, reason: "No available time before the deadline." }] } } satisfies Meta<typeof UnscheduledWorkList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Outstanding: Story = {};
export const Empty: Story = { args: { items: [] } };
