import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { expect, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Dropdown-menu", component: DropdownMenu, args: {  } } satisfies Meta<typeof DropdownMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="outline" />}>Task actions</DropdownMenuTrigger>
  <DropdownMenuContent><DropdownMenuGroup><DropdownMenuLabel>Coursework</DropdownMenuLabel>
    <DropdownMenuItem>Edit task<DropdownMenuShortcut>⌘E</DropdownMenuShortcut></DropdownMenuItem>
    <DropdownMenuCheckboxItem defaultChecked>Show completed</DropdownMenuCheckboxItem>
    <DropdownMenuSub><DropdownMenuSubTrigger>Priority</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuRadioGroup defaultValue="medium"><DropdownMenuRadioItem value="low">Low</DropdownMenuRadioItem><DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>
    <DropdownMenuSeparator /><DropdownMenuItem variant="destructive">Delete task</DropdownMenuItem>
  </DropdownMenuGroup></DropdownMenuContent>
</DropdownMenu>, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Task actions" }));
  await waitFor(async () => expect(await within(document.body).findByRole("menuitem", { name: /Edit task/ })).toBeVisible());
  await userEvent.keyboard("{Escape}");
} };
