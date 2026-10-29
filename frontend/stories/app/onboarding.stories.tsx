import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GettingStarted, WelcomeTour } from "@/components/onboarding";

const meta = { title: "App/onboarding", component: GettingStarted, parameters: { app: true }, args: { state: { weeklyWindows: 0, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 }, ready: true } } satisfies Meta<typeof GettingStarted>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NewAccount: Story = {};
export const Partial: Story = { args: { state: { weeklyWindows: 3, openTasks: 2, plannedSessions: 0, recordedOutcomes: 0 } } };
export const Complete: Story = { args: { state: { weeklyWindows: 3, openTasks: 2, plannedSessions: 4, recordedOutcomes: 1 } } };
export const Welcome: Story = { render: (args) => <WelcomeTour {...args} /> };
