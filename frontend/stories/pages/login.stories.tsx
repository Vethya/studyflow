import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(auth)/login/page";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { expect, userEvent, waitFor, within } from "storybook/test";
import AuthLayout from "@/app/(auth)/layout";

const meta = {
  title: "Pages/auth/login", component: Page,
  parameters: { app: true, layout: "fullscreen", api: { authenticated: false }, nextjs: { navigation: { pathname: "/login" } } },
  decorators: [(Story) => <AuthLayout><Story /></AuthLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ServiceError: Story = { parameters: { api: { authenticated: false, state: "error" } } };
export const Registered: Story = { parameters: { nextjs: { navigation: { query: { "registered": "1" } } } } };
export const PasswordReset: Story = { parameters: { nextjs: { navigation: { query: { "reset": "1" } } } } };

export const SignIn: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(await canvas.findByLabelText("Email"), "alex@example.edu");
  await userEvent.type(canvas.getByLabelText("Password", { exact: true }), "local-demo-passphrase");
  await userEvent.click(canvas.getByRole("button", { name: "Sign In" }));
  await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith("/dashboard"));
} };
export const FailedSignIn: Story = { parameters: { api: { authenticated: false, state: "error" } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(await canvas.findByLabelText("Email"), "alex@example.edu");
  await userEvent.type(canvas.getByLabelText("Password", { exact: true }), "local-demo-passphrase");
  await userEvent.click(canvas.getByRole("button", { name: "Sign In" }));
  await expect(await canvas.findByText(/service temporarily unavailable/)).toBeInTheDocument();
} };
