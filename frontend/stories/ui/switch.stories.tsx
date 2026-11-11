import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Switch } from "@/components/ui/switch";
import { expect, fn, userEvent, within } from "storybook/test";


const meta = { title: "UI/Switch", component: Switch, args: { "aria-label": "Enable reminders", onCheckedChange: fn() } } satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { play: async ({ canvasElement, args }) => {
  const control = within(canvasElement).getByRole("switch", { name: "Enable reminders" });
  await userEvent.click(control);
  await expect(control).toBeChecked();
  await expect(args.onCheckedChange).toHaveBeenCalled();
} };
export const Checked: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { disabled: true } };
