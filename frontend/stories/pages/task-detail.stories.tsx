import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(app)/tasks/[taskId]/page";
import AppLayout from "@/app/(app)/layout";
import { expect, within } from "storybook/test";

const params = Promise.resolve({ taskId: "reading" });
const meta = {
  title: "Pages/task-detail", component: Page, args: { params },
  parameters: { app: true, layout: "fullscreen", nextjs: { navigation: { pathname: "/tasks/reading" } } },
  decorators: [(Story) => <AppLayout><Story /></AppLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = { play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByRole("heading", { name: "Read cognitive science paper" })).toBeInTheDocument(); } };
export const NotFound: Story = { args: { params: Promise.resolve({ taskId: "missing" }) } };
export const Loading: Story = { parameters: { api: { state: "loading" } } };
export const ServiceError: Story = { parameters: { api: { state: "error" } } };
