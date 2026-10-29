import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GoogleImportButton, GoogleImportReminder } from "@/components/google-import-button";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/google-import", component: GoogleImportButton, parameters: { app: true }, args: { source: "google_calendar" } } satisfies Meta<typeof GoogleImportButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Calendar: Story = { play: async ({ canvasElement }) => {
  const button = await within(canvasElement).findByRole("button");
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await expect(await within(document.body).findByRole("dialog")).toBeInTheDocument();
} };
export const Classroom: Story = { ...Calendar, args: { source: "google_classroom" } };
export const Reminder: Story = { render: () => <GoogleImportReminder source="google_classroom" /> };
export const Loading: Story = { parameters: { api: { state: "loading" } } };
export const ServiceError: Story = { parameters: { api: { state: "error" } } };
