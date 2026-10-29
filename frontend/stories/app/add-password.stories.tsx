import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AddPasswordDialog } from "@/components/settings-dialogs";
import { DialogDemo } from "../dialog-demo";
import { requests } from "../mock-api";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/add-password", component: AddPasswordDialog, parameters: { app: true }, args: { open: false, onOpenChange: fn() } } satisfies Meta<typeof AddPasswordDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <DialogDemo label="Open password form">{(open, onOpenChange) => <AddPasswordDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo>, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Open password form" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  await userEvent.type(dialog.getByLabelText("New password", { exact: true }), "local-demo-passphrase");
  await userEvent.type(dialog.getByLabelText("Repeat new password"), "local-demo-passphrase");
  await userEvent.click(dialog.getByRole("button", { name: "Add password" }));
  await waitFor(() => expect(requests.some((r) => r.path === "/account/password")).toBe(true));
} };
export const Editing: Story = { ...Default, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: "Open password form" })); } };
