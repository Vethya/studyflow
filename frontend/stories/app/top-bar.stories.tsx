import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TopBar } from "@/components/top-bar";
import { CommandMenuProvider } from "@/components/command-menu";
import { SidebarProvider } from "@/components/ui/sidebar";
import { expect, userEvent, within } from "storybook/test";

const meta = { title: "App/top-bar", component: TopBar, parameters: { app: true, nextjs: { navigation: { pathname: "/tasks/reading" } } }, args: {  } } satisfies Meta<typeof TopBar>;
export default meta;
type Story = StoryObj<typeof meta>;

async function search(canvasElement: HTMLElement, query: string) {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Search tasks, pages and actions" }));
  await userEvent.type(await within(document.body).findByRole("combobox", { name: "Search tasks, pages and actions" }), query);
  return within(document.body);
}

export const Search: Story = { render: () => <SidebarProvider><CommandMenuProvider><TopBar /></CommandMenuProvider></SidebarProvider>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/tasks");
  await expect(canvas.getByText("Task")).toHaveAttribute("aria-current", "page");
  const body = await search(canvasElement, "cognitive");
  await expect(await body.findByRole("option", { name: /Read cognitive science paper/ })).toBeInTheDocument();
} };
export const NoMatches: Story = { ...Search, play: async ({ canvasElement }) => {
  const body = await search(canvasElement, "unknown task");
  await expect(await body.findByText("Nothing matches “unknown task”.")).toBeInTheDocument();
} };
