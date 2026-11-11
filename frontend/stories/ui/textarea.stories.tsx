import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Textarea } from "@/components/ui/textarea";
import { expect, fn, userEvent, within } from "storybook/test";


const meta = { title: "UI/Textarea", component: Textarea, args: { "aria-label": "Task title", placeholder: "Read chapter 4", onChange: fn() } } satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { play: async ({ canvasElement, args }) => {
  const field = within(canvasElement).getByRole("textbox", { name: "Task title" });
  await userEvent.type(field, "Essay draft");
  await expect(field).toHaveValue("Essay draft");
  await expect(args.onChange).toHaveBeenCalled();
} };
export const Disabled: Story = { args: { disabled: true, defaultValue: "Cannot edit" } };
export const Invalid: Story = { args: { "aria-invalid": true, defaultValue: "Missing deadline" } };
