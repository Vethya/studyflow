import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TopBar } from "@/components/top-bar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { expect, userEvent, within } from "storybook/test";

const meta = { title: "App/top-bar", component: TopBar, parameters: { app: true }, args: {  } } satisfies Meta<typeof TopBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Search: Story = { render: () => <SidebarProvider><TopBar /></SidebarProvider>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(await canvas.findByRole("searchbox"), "cognitive");
  await expect(await canvas.findByText("Read cognitive science paper")).toBeInTheDocument();
  await userEvent.click(canvas.getByRole("button", { name: "Clear search" }));
  await expect(canvas.getByRole("searchbox")).toHaveValue("");
} };
export const NoMatches: Story = { ...Search, play: async ({ canvasElement }) => { await userEvent.type(await within(canvasElement).findByRole("searchbox"), "unknown task"); } };
