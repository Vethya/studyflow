import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CapacityBar } from "@/components/capacity-bar";

const meta = { title: "App/capacity-bar", component: CapacityBar, parameters: { app: true }, args: { available: 480, committed: 360 } } satisfies Meta<typeof CapacityBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Fits: Story = {};
export const Full: Story = { args: { committed: 480 } };
export const Overload: Story = { args: { committed: 720 } };
export const NoCapacity: Story = { args: { available: 0, committed: 120 } };
export const Empty: Story = { args: { available: 0, committed: 0 } };
