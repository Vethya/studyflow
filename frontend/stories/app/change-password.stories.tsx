import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChangePasswordDialog } from "@/components/settings-dialogs";
import { DialogDemo } from "../dialog-demo";
import { requests } from "../mock-api";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/change-password", component: ChangePasswordDialog, parameters: { app: true }, args: { open: false, onOpenChange: fn() } } satisfies Meta<typeof ChangePasswordDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <DialogDemo label="Open password form">{(open, onOpenChange) => <ChangePasswordDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo>, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Open password form" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  await userEvent.type(dialog.getByLabelText("Current password"), "previous-passphrase");
  await userEvent.type(dialog.getByLabelText("New password", { exact: true }), "local-demo-passphrase");
  await userEvent.type(dialog.getByLabelText("Repeat new password"), "local-demo-passphrase");
  await userEvent.click(dialog.getByRole("button", { name: "Change password" }));
  await waitFor(() => expect(requests.some((r) => r.path === "/account/password")).toBe(true));
} };
export const Editing: Story = { ...Default, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: "Open password form" })); } };
