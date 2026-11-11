import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(auth)/verify-email/page";
import AuthLayout from "@/app/(auth)/layout";

const meta = {
  title: "Pages/auth/verify-email", component: Page,
  parameters: { app: true, layout: "fullscreen", api: { authenticated: false }, nextjs: { navigation: { pathname: "/verify-email" } } },
  decorators: [(Story) => <AuthLayout><Story /></AuthLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ServiceError: Story = { parameters: { api: { authenticated: false, state: "error" } } };
export const CompleteRegistration: Story = { parameters: { nextjs: { navigation: { query: { "token": "storybook-verification" } } } } };
