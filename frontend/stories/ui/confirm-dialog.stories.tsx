import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { expect, fn, userEvent, within } from "storybook/test";


const meta = { title: "UI/Confirm-dialog", component: ConfirmDialog, args: { open: false, onOpenChange: fn(), title: "Delete task?", description: "This removes the task and its future sessions.", confirmLabel: "Delete task", destructive: true, onConfirm: fn() } } satisfies Meta<typeof ConfirmDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: function Render(args) {
  const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)}>Delete task</Button><ConfirmDialog {...args} open={open} onOpenChange={setOpen} /></>;
}, play: async ({ canvasElement, args }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Delete task" }));
  const dialog = await within(document.body).findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete task" }));
  await expect(args.onConfirm).toHaveBeenCalledOnce();
} };
export const Pending: Story = { ...Default, args: { onConfirm: fn(() => new Promise<void>(() => {})) } , play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Delete task" }));
  const dialog = await within(document.body).findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete task" }));
  await expect(within(dialog).getByRole("button", { name: "Delete task" })).toBeDisabled();
} };
