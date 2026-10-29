import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GuestOnly } from "@/components/auth/guest-only";

const meta = { title: "App/guest-only", component: GuestOnly, parameters: { app: true }, args: { children: <p>Sign in to StudyFlow</p> } } satisfies Meta<typeof GuestOnly>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = { parameters: { api: { authenticated: false } } };
export const RedirectSignedIn: Story = {};
