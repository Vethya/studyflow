import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DetailDrawer } from "@/components/detail-drawer";
import { DialogDemo } from "../dialog-demo";
import { fn } from "storybook/test";

const meta = { title: "App/detail-drawer", component: DetailDrawer, parameters: { app: true }, args: { open: false, onOpenChange: fn(), title: "Session details", description: "Read cognitive science paper", children: <p className="p-6">60 minutes planned for this session.</p> } } satisfies Meta<typeof DetailDrawer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <DialogDemo label="View details">{(open, onOpenChange) => <DetailDrawer {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo> };
export const Wide: Story = { ...Default, args: { size: "wide" } };
