import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(auth)/register/page";
import { expect, userEvent, within } from "storybook/test";
import AuthLayout from "@/app/(auth)/layout";

const meta = {
  title: "Pages/auth/register", component: Page,
  parameters: { app: true, layout: "fullscreen", api: { authenticated: false }, nextjs: { navigation: { pathname: "/register" } } },
  decorators: [(Story) => <AuthLayout><Story /></AuthLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ServiceError: Story = { parameters: { api: { authenticated: false, state: "error" } } };

export const EmailSent: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(await canvas.findByLabelText("Email"), "alex@example.edu");
  await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
  await expect(await canvas.findByRole("heading", { name: "Check your inbox" })).toBeInTheDocument();
} };
