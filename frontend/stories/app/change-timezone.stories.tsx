import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChangeTimezoneDialog } from "@/components/settings-dialogs";
import { DialogDemo } from "../dialog-demo";
import { preferences } from "../fixtures";
import { fn } from "storybook/test";

const meta = { title: "App/change-timezone", component: ChangeTimezoneDialog, parameters: { app: true }, args: { open: false, onOpenChange: fn(), preferences, onSaved: fn() } } satisfies Meta<typeof ChangeTimezoneDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <DialogDemo label="Change timezone">{(open, onOpenChange) => <ChangeTimezoneDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo> };
