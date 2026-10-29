import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AddWindowDialog } from "@/components/availability-dialogs";
import { DialogDemo } from "../dialog-demo";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/availability-window", component: AddWindowDialog, parameters: { app: true }, args: { open: false, onOpenChange: fn(), onSubmit: fn(async () => {}) } } satisfies Meta<typeof AddWindowDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Add: Story = { render: (args) => <DialogDemo label="Add weekly window">{(open, onOpenChange) => <AddWindowDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo>, play: async ({ canvasElement, args }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Add weekly window" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  await userEvent.click(dialog.getByRole("button", { name: "Add window" }));
  await waitFor(() => expect(args.onSubmit).toHaveBeenCalledWith({ dayOfWeek: 1, startTime: "18:00", endTime: "21:00" }));
} };
export const Overnight: Story = { ...Add, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Add weekly window" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Start"), { target: { value: "22:00" } });
  fireEvent.change(dialog.getByLabelText("End"), { target: { value: "02:00" } });
} };
export const SaveError: Story = { ...Add, args: { onSubmit: fn(async () => { throw new Error("Could not save window."); }) }, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Add weekly window" }));
  await userEvent.click(within(await within(document.body).findByRole("dialog")).getByRole("button", { name: "Add window" }));
  await expect(await within(document.body).findByText("Could not save window.")).toBeInTheDocument();
} };
