import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DashboardFocus } from "@/components/dashboard-focus";
import { sessions } from "../fixtures";
import { fn } from "storybook/test";

const meta = { title: "App/dashboard-focus", component: DashboardFocus, parameters: { app: true }, args: { ready: true, hasWindows: true, openTasks: 2, pendingPlan: false, awaitingOutcome: 0, nextSession: null, onReview: fn(), onRecord: fn() } } satisfies Meta<typeof DashboardFocus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PlanMyTime: Story = {};
export const SetStudyHours: Story = { args: { hasWindows: false, openTasks: 0 } };
export const PendingPlan: Story = { args: { pendingPlan: true } };
export const AwaitingOutcome: Story = { args: { awaitingOutcome: 2 } };
export const NextSession: Story = { args: { nextSession: sessions[1] } };
export const Loading: Story = { args: { ready: false } };
