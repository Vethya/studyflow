import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { expect, userEvent, within } from "storybook/test";


const meta = { title: "UI/Command", component: Command, args: {  } } satisfies Meta<typeof Command>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Command className="max-w-md rounded-lg border"><CommandInput placeholder="Search coursework" /><CommandList><CommandEmpty>No matching tasks.</CommandEmpty><CommandGroup heading="Tasks"><CommandItem>Read paper<CommandShortcut>↵</CommandShortcut></CommandItem><CommandItem>Draft essay</CommandItem></CommandGroup><CommandSeparator /><CommandGroup heading="Pages"><CommandItem>Calendar</CommandItem></CommandGroup></CommandList></Command>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByRole("combobox"), "no-such-task");
  await expect(canvas.getByText("No matching tasks.")).toBeVisible();
} };
