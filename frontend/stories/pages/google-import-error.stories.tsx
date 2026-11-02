import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(app)/import/google/page";
import AppLayout from "@/app/(app)/layout";
import { expect, within } from "storybook/test";
const meta = {
  title: "Pages/google-import-error", component: Page,
  parameters: { app: true, layout: "fullscreen", nextjs: { navigation: { pathname: "/import/google" } } },
  decorators: [(Story) => <AppLayout><Story /></AppLayout>],
  play: async ({ canvasElement, parameters }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Search tasks, pages and actions" })).toBeInTheDocument();
    await expect(await canvas.findByRole("heading", { level: 1, name: "Google import" })).toBeInTheDocument();
    await expect(await canvas.findByRole("heading", { level: 2, name: parameters.message })).toBeInTheDocument();
  },
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Invalid: Story = { parameters: { message: "The Google import could not be completed" } };
export const Cancelled: Story = { parameters: { message: "You cancelled the Google import", nextjs: { navigation: { query: { error: "denied" } } } } };
export const MissingPermissions: Story = { parameters: { message: "StudyFlow did not get the access it needs", nextjs: { navigation: { query: { error: "permission" } } } } };
export const Unavailable: Story = { parameters: { message: "Google is not responding right now", nextjs: { navigation: { query: { error: "unavailable" } } } } };
