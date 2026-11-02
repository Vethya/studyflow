import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FocusTimer } from "@/components/focus-timer";
import { clearFocusTimer, startTimer, updateFocusTimer } from "@/lib/focus-timer";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/focus-timer", component: FocusTimer, parameters: { app: true }, args: {  }, beforeEach: () => { clearFocusTimer(); return clearFocusTimer; } } satisfies Meta<typeof FocusTimer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Panel: Story = { play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Focus timer" }));
  const timer = await within(document.body).findByRole("timer", { name: /Focus, .* left/ });
  await waitFor(() => expect(timer).toBeVisible());
} };
export const Running: Story = { beforeEach: () => { updateFocusTimer((state) => startTimer(state, Date.now())); } };
