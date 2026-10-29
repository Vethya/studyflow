import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AccountDeletionDialog } from "@/components/settings-dialogs";
import { DialogDemo } from "../dialog-demo";
import { fn } from "storybook/test";

const meta = { title: "App/account-deletion", component: AccountDeletionDialog, parameters: { app: true }, args: { open: false, onOpenChange: fn(), passwordSet: true, googleReady: false, onStartGoogle: fn(async () => {}), onGoogleChallengeExpired: fn(), onDeleted: fn() } } satisfies Meta<typeof AccountDeletionDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PasswordAccount: Story = { render: (args) => <DialogDemo label="Delete demo account">{(open, onOpenChange) => <AccountDeletionDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo> };
export const GoogleAccount: Story = { ...PasswordAccount, args: { passwordSet: false } };
export const GoogleConfirmed: Story = { ...PasswordAccount, args: { passwordSet: false, googleReady: true } };
