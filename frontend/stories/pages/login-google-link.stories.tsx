import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(auth)/login/google-link/page";
import AuthLayout from "@/app/(auth)/layout";

const meta = {
  title: "Pages/auth/login-google-link", component: Page,
  parameters: { app: true, layout: "fullscreen", api: { authenticated: false }, nextjs: { navigation: { pathname: "/login/google-link" } } },
  decorators: [(Story) => <AuthLayout><Story /></AuthLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ServiceError: Story = { parameters: { api: { authenticated: false, state: "error" } } };
