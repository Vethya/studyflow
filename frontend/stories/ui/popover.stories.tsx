import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { expect, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Popover", component: Popover, args: {  } } satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Popover {...args}><PopoverTrigger render={<Button variant="outline" />}>Study preferences</PopoverTrigger><PopoverContent><PopoverHeader><PopoverTitle>Session length</PopoverTitle><PopoverDescription>Keep sessions under 60 minutes.</PopoverDescription></PopoverHeader></PopoverContent></Popover>, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Study preferences" }));
  await waitFor(() => expect(within(document.body).getByText("Keep sessions under 60 minutes.")).toBeVisible());
  await userEvent.keyboard("{Escape}");
} };
