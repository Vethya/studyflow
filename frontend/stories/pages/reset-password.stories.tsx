import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(auth)/reset-password/page";
import AuthLayout from "@/app/(auth)/layout";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  title: "Pages/auth/reset-password", component: Page,
  parameters: { app: true, layout: "fullscreen", api: { authenticated: false }, nextjs: { navigation: { pathname: "/reset-password" } } },
  decorators: [(Story) => <AuthLayout><Story /></AuthLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ServiceError: Story = {
  parameters: { api: { authenticated: false, state: "error" }, nextjs: { navigation: { query: { token: "storybook-reset" } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText("New password"), "Storybook-password-42");
    await userEvent.type(canvas.getByLabelText("Confirm new password"), "Storybook-password-42");
    await userEvent.click(canvas.getByRole("button", { name: "Set password" }));
    await expect(await canvas.findByText(/service temporarily unavailable/)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Set password" })).toBeEnabled();
  },
};
export const WithToken: Story = { parameters: { nextjs: { navigation: { query: { "token": "storybook-reset" } } } } };
