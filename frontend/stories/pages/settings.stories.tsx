import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(app)/settings/page";
import AppLayout from "@/app/(app)/layout";
import { expect, within } from "storybook/test";

const meta = {
  title: "Pages/settings", component: Page,
  parameters: { app: true, layout: "fullscreen", nextjs: { navigation: { pathname: "/settings" } } },
  decorators: [(Story) => <AppLayout><Story /></AppLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = { play: async ({ canvasElement }) => {
  await expect(await within(canvasElement).findByRole("heading", { name: "Settings" })).toBeInTheDocument();
} };
export const Empty: Story = { parameters: { api: { state: "empty" } } };
export const Loading: Story = { parameters: { api: { state: "loading" } } };
export const ServiceError: Story = { parameters: { api: { state: "error" } } };
