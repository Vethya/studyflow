import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { OverloadWarningList } from "@/components/overload-warning-list";
import { task } from "../fixtures";

const meta = { title: "App/overload-warning", component: OverloadWarningList, parameters: { app: true }, args: { warnings: [{ taskId: task.id, taskTitle: task.title, deadline: task.deadline, requiredMinutes: 180, availableMinutes: 120, shortfallMinutes: 60, relevantUnavailablePeriods: [], remedies: ["extend_deadline", "add_availability"] }] } } satisfies Meta<typeof OverloadWarningList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Warning: Story = {};
export const Empty: Story = { args: { warnings: [] } };
