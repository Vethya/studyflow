import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SessionDrawer } from "@/components/session-drawer";
import { DialogDemo } from "../dialog-demo";
import { task, sessions } from "../fixtures";
import { fn } from "storybook/test";

const meta = { title: "App/session-drawer", component: SessionDrawer, parameters: { app: true }, args: { session: sessions[0], task, open: false, onOpenChange: fn(), onEditTask: fn(), onDeleteTask: fn(), onRecordOutcome: fn() } } satisfies Meta<typeof SessionDrawer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AwaitingOutcome: Story = { render: (args) => <DialogDemo label="View session">{(open, onOpenChange) => <SessionDrawer {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo> };
export const Upcoming: Story = { ...AwaitingOutcome, args: { session: sessions[1] } };
export const Completed: Story = { ...AwaitingOutcome, args: { session: { ...sessions[0], outcome: "Completed", actualDuration: 60, isAwaitingOutcome: false } } };
export const Delayed: Story = { ...AwaitingOutcome, args: { session: { ...sessions[0], outcome: "Delayed", actualDuration: 30, isAwaitingOutcome: false } } };
export const Missed: Story = { ...AwaitingOutcome, args: { session: { ...sessions[0], outcome: "Missed", actualDuration: 0, isAwaitingOutcome: false } } };
