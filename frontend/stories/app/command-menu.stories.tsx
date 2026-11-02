import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CommandMenuProvider, ShortcutsDialog, useCommandMenu } from "@/components/command-menu";
import { Button } from "@/components/ui/button";
import { expect, fn, userEvent, within } from "storybook/test";

function Launcher() {
  const { openMenu, openNewTask, openShortcuts } = useCommandMenu();
  return <div className="flex gap-2"><Button onClick={openMenu}>Open command menu</Button><Button variant="outline" onClick={openNewTask}>Add a task</Button><Button variant="outline" onClick={openShortcuts}>Keyboard shortcuts</Button></div>;
}

const meta = { title: "App/command-menu", component: CommandMenuProvider, parameters: { app: true }, args: { children: <Launcher /> } } satisfies Meta<typeof CommandMenuProvider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Menu: Story = { play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Open command menu" }));
  const body = within(document.body);
  await userEvent.type(await body.findByRole("combobox", { name: "Search tasks, pages and actions" }), "cognitive");
  await expect(await body.findByRole("option", { name: /Read cognitive science paper/ })).toBeInTheDocument();
} };
export const Shortcuts: Story = { render: () => <ShortcutsDialog open onOpenChange={fn()} /> };
