import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(app)/import/google/page";
import AppLayout from "@/app/(app)/layout";
import { expect, within } from "storybook/test";
const meta = {
  title: "Pages/google-import-error", component: Page,
  parameters: { app: true, layout: "fullscreen", nextjs: { navigation: { pathname: "/import/google" } } },
  decorators: [(Story) => <AppLayout><Story /></AppLayout>],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("button", { name: "Toggle Sidebar" })).toBeInTheDocument();
    await expect(await within(canvasElement).findByRole("heading", { name: /Google import/i })).toBeInTheDocument();
  },
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Invalid: Story = {};
export const Cancelled: Story = { parameters: { nextjs: { navigation: { query: { error: "denied" } } } } };
export const MissingPermissions: Story = { parameters: { nextjs: { navigation: { query: { error: "permission" } } } } };
export const Unavailable: Story = { parameters: { nextjs: { navigation: { query: { error: "unavailable" } } } } };
