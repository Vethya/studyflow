import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(app)/calendar/page";
import AppLayout from "@/app/(app)/layout";
import { expect, within } from "storybook/test";

const meta = {
  title: "Pages/calendar", component: Page,
  parameters: { app: true, layout: "fullscreen", nextjs: { navigation: { pathname: "/calendar" } } },
  decorators: [(Story) => <AppLayout><Story /></AppLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = { play: async ({ canvasElement }) => {
  await expect(await within(canvasElement).findByRole("heading", { level: 1 })).toBeInTheDocument();
} };
export const Empty: Story = { parameters: { api: { state: "empty" } } };
export const Loading: Story = { parameters: { api: { state: "loading" } } };
export const ServiceError: Story = { parameters: { api: { state: "error" } } };
export const PendingPlan: Story = { parameters: { api: { pending: true } } };
