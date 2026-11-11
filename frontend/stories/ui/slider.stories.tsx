import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Slider } from "@/components/ui/slider";
import { expect, fn, userEvent, within } from "storybook/test";


const meta = { title: "UI/Slider", component: Slider, args: { defaultValue: [45], min: 15, max: 120, step: 15, getAriaLabel: () => "Session length", onValueChange: fn() } } satisfies Meta<typeof Slider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { play: async ({ canvasElement, args }) => {
  const thumb = within(canvasElement).getByRole("slider", { name: "Session length" });
  thumb.focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect(thumb).toHaveAttribute("aria-valuenow", "60");
  await expect(args.onValueChange).toHaveBeenCalled();
} };
export const Range: Story = { args: { defaultValue: [30, 90], getAriaLabel: (index = 0) => index === 0 ? "Minimum" : "Maximum" } };
export const Disabled: Story = { args: { disabled: true } };
