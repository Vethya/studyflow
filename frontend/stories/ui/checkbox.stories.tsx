import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Checkbox } from "@/components/ui/checkbox";
import { expect, fn, userEvent, within } from "storybook/test";


const meta = { title: "UI/Checkbox", component: Checkbox, args: { "aria-label": "Enable reminders", onCheckedChange: fn() } } satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { play: async ({ canvasElement, args }) => {
  const control = within(canvasElement).getByRole("checkbox", { name: "Enable reminders" });
  await userEvent.click(control);
  await expect(control).toBeChecked();
  await expect(args.onCheckedChange).toHaveBeenCalled();
} };
export const Checked: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { disabled: true } };
