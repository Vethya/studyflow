import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(auth)/login/google-error/[reason]/page";
import AuthLayout from "@/app/(auth)/layout";

const meta = {
  title: "Pages/auth/google-error", component: Page,
  args: { params: Promise.resolve({ reason: "denied" }) },
  parameters: { app: true, layout: "fullscreen", api: { authenticated: false } },
  decorators: [(Story) => <AuthLayout><Story /></AuthLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Cancelled: Story = {};
export const Unavailable: Story = { args: { params: Promise.resolve({ reason: "unavailable" }) } };
export const Invalid: Story = { args: { params: Promise.resolve({ reason: "invalid" }) } };
