import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChangeNameDialog } from "@/components/settings-dialogs";
import { DialogDemo } from "../dialog-demo";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/change-name", component: ChangeNameDialog, parameters: { app: true }, args: { open: false, onOpenChange: fn(), currentName: "Alex Student", onSaved: fn() } } satisfies Meta<typeof ChangeNameDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <DialogDemo label="Edit name">{(open, onOpenChange) => <ChangeNameDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo>, play: async ({ canvasElement, args }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Edit name" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  await userEvent.clear(dialog.getByLabelText("Name"));
  await userEvent.type(dialog.getByLabelText("Name"), "Alex Chen");
  await userEvent.click(dialog.getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(args.onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Alex Chen" })));
} };
