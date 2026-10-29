import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { DateRange } from "react-day-picker";
import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { expect, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Calendar", component: Calendar, args: { defaultMonth: new Date("2026-10-01T12:00:00Z") } } satisfies Meta<typeof Calendar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = { render: function Render(args) {
  const [selected, setSelected] = useState<Date>();
  return <Calendar {...args} mode="single" selected={selected} onSelect={setSelected} />;
}, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const day = canvas.getByRole("button", { name: /Friday, October 16th/ });
  await userEvent.click(day);
  await waitFor(() => expect(canvas.getByRole("button", { name: /Friday, October 16th/ })).toHaveAttribute("data-selected-single", "true"));
} };
export const Range: Story = { args: { numberOfMonths: 2, buttonVariant: "outline" }, render: function Render(args) {
  const [selected, setSelected] = useState<DateRange | undefined>({ from: new Date("2026-10-16T12:00:00Z"), to: new Date("2026-10-20T12:00:00Z") });
  return <Calendar {...args} mode="range" selected={selected} onSelect={setSelected} />;
}, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByRole("button", { name: /previous month/i })).toHaveClass(/btn-outline/);
} };
