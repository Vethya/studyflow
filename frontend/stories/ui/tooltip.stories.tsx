import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";


const meta = { title: "UI/Tooltip", component: Tooltip, args: {  } } satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Visible: Story = { args: { defaultOpen: true }, render: (args) => <Tooltip {...args}><TooltipTrigger render={<Button variant="outline" />}>Capacity</TooltipTrigger><TooltipContent>Study hours available before the deadline</TooltipContent></Tooltip> };
export const HoverOrFocus: Story = { ...Visible, args: { defaultOpen: false } };
