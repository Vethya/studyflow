import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RecordOutcomeDialog } from "@/components/record-outcome-dialog";
import { DialogDemo } from "../dialog-demo";
import { sessions } from "../fixtures";
import { requests } from "../mock-api";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/record-outcome", component: RecordOutcomeDialog, parameters: { app: true }, args: { session: sessions[0], open: false, onOpenChange: fn(), onRecorded: fn() } } satisfies Meta<typeof RecordOutcomeDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

const record = (choice: "missed" | "completed" | "delayed"): NonNullable<Story["play"]> => async ({ canvasElement, args }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Record outcome" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  if (choice !== "missed") {
    await userEvent.click(dialog.getByRole("button", { name: choice === "completed" ? /Finished it/ : /Partly done/ }));
    const worked = dialog.getByLabelText("Minutes you worked");
    await userEvent.clear(worked);
    await userEvent.type(worked, "30");
    if (choice === "delayed") {
      const remaining = dialog.getByLabelText("Minutes still left");
      await userEvent.clear(remaining);
      await userEvent.type(remaining, "45");
    }
  }
  await userEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(args.onRecorded).toHaveBeenCalledOnce());
  await expect(requests.find((r) => r.path.endsWith("/outcomes"))?.body).toMatchObject(choice === "missed" ? { outcome: choice } : { outcome: choice, actual_minutes: 30 });
  await expect(args.onRecorded).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ outcome: { missed: "Missed", completed: "Completed", delayed: "Delayed" }[choice] }) }));
};
export const Missed: Story = { render: (args) => <DialogDemo label="Record outcome">{(open, onOpenChange) => <RecordOutcomeDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo>, play: record("missed") };
export const Completed: Story = { ...Missed, play: record("completed") };
export const Delayed: Story = { ...Missed, play: record("delayed") };
export const Editing: Story = { ...Missed, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: "Record outcome" })); } };
