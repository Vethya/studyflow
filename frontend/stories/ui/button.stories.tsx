import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "@/components/ui/button";

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "Create task", onClick: fn() },
  argTypes: {
    variant: { control: "select", options: ["default", "outline", "secondary", "ghost", "destructive", "link"] },
    size: { control: "select", options: ["default", "xs", "sm", "lg"] },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Create task" }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
export const Disabled: Story = { args: { disabled: true } };
export const Variants: Story = {
  render: (args) => <div className="flex flex-wrap gap-3">{(["default", "outline", "secondary", "ghost", "destructive", "link"] as const).map((variant) => <Button {...args} key={variant} variant={variant}>{variant}</Button>)}</div>,
};
