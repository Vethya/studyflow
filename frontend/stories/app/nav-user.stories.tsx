import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NavUser } from "@/components/nav-user";
import { SidebarProvider, Sidebar } from "@/components/ui/sidebar";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/nav-user", component: NavUser, parameters: { app: true }, args: {  } } satisfies Meta<typeof NavUser>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AccountMenu: Story = { render: () => <SidebarProvider><Sidebar><NavUser /></Sidebar></SidebarProvider>, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Account menu" }));
  await waitFor(() => expect(within(document.body).getByRole("menuitem", { name: /Log out/ })).toBeVisible());
} };
