import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ExceptionDialog } from "@/components/availability-dialogs";
import { DialogDemo } from "../dialog-demo";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/unavailable-period", component: ExceptionDialog, parameters: { app: true }, args: { open: false, onOpenChange: fn(), onSubmit: fn(async () => {}) } } satisfies Meta<typeof ExceptionDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Add: Story = { render: (args) => <DialogDemo label="Block time">{(open, onOpenChange) => <ExceptionDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo>, play: async ({ canvasElement, args }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Block time" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Starts"), { target: { value: "2026-10-18T18:00" } });
  fireEvent.change(dialog.getByLabelText("Ends"), { target: { value: "2026-10-18T19:00" } });
  await userEvent.type(dialog.getByLabelText("Reason (optional)"), "Office hours");
  await userEvent.click(dialog.getByRole("button", { name: "Add exception" }));
  await waitFor(() => expect(args.onSubmit).toHaveBeenCalledOnce());
} };
export const Edit: Story = { ...Add, args: { period: { id: "blocked", title: "Office hours", startDate: "2026-10-18T11:00:00Z", endDate: "2026-10-18T12:00:00Z", reason: "Office hours" } }, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: "Block time" })); } };
