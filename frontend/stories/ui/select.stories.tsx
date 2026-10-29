import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectSeparator } from "@/components/ui/select";
import { expect, fn, userEvent, within } from "storybook/test";


const meta = { title: "UI/Select", component: Select, args: { defaultValue: "medium", onValueChange: fn() } } satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Select {...args} items={{ low: "Low", medium: "Medium", high: "High" }}><SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Priority</SelectLabel><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectSeparator /><SelectItem value="high">High</SelectItem></SelectGroup></SelectContent></Select>, play: async ({ canvasElement, args }) => {
  await userEvent.click(within(canvasElement).getByRole("combobox", { name: "Priority" }));
  await userEvent.click(await within(document.body).findByRole("option", { name: "High" }));
  await expect(args.onValueChange).toHaveBeenCalledWith("high", expect.anything());
} };
export const Disabled: Story = { ...Default, args: { disabled: true }, play: undefined };
