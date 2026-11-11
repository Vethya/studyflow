import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/(app)/import/google/[importId]/page";
import { requests } from "../mock-api";
import AppLayout from "@/app/(app)/layout";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  title: "Pages/google-import-review", component: Page,
  args: { params: Promise.resolve({ importId: "import-calendar" }) },
  parameters: { app: true, layout: "fullscreen" },
  decorators: [(Story) => <AppLayout><Story /></AppLayout>],
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Calendar: Story = { play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByText("Part-time shift")).toBeInTheDocument(); } };
export const Classroom: Story = { args: { params: Promise.resolve({ importId: "import-classroom" }) }, play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByText("Lab report")).toBeInTheDocument(); } };
export const Empty: Story = { parameters: { api: { state: "empty" } } };
export const Loading: Story = { parameters: { api: { state: "loading" } } };
export const ServiceError: Story = { parameters: { api: { state: "error" } } };

export const ConfirmCalendar: Story = { play: async (context) => {
  await Calendar.play!(context);
  await userEvent.click(within(context.canvasElement).getByRole("button", { name: "Block 2 events" }));
  await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path.endsWith("/calendar"))).toBe(true));
} };
