import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import DashboardShell, { navData } from "@/components/shadcn-space/blocks/dashboard-shell-01/app-sidebar";
import { NavMain } from "@/components/shadcn-space/blocks/dashboard-shell-01/nav-main";
import NotificationDropdown from "@/components/shadcn-space/blocks/dashboard-shell-01/notification-dropdown";
import { SiteHeader } from "@/components/shadcn-space/blocks/dashboard-shell-01/site-header";
import UserDropdown from "@/components/shadcn-space/blocks/dashboard-shell-01/user-dropdown";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import { rememberProductTourSeen } from "@/lib/onboarding";
import { account } from "../fixtures";
import { expect, userEvent, waitFor, within } from "storybook/test";

// The first-visit tour would cover the shell; it has its own stories.
const meta = { title: "App/dashboard-shell", component: DashboardShell, parameters: { app: true, layout: "fullscreen", nextjs: { navigation: { pathname: "/dashboard" } } }, args: { children: <p className="p-6">Dashboard</p> }, beforeEach: () => { rememberProductTourSeen(account.id); } } satisfies Meta<typeof DashboardShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Shell: Story = { play: async ({ canvasElement }) => {
  await expect(await within(canvasElement).findByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
} };
export const Navigation: Story = { parameters: { nextjs: { navigation: { pathname: "/tasks/reading" } } }, render: () => <SidebarProvider><Sidebar><div className="p-4"><NavMain items={navData} /></div></Sidebar></SidebarProvider> };
export const Header: Story = { render: () => <SidebarProvider><header className="flex h-14 w-full items-center border-b px-4"><SiteHeader /></header></SidebarProvider> };
export const Reminders: Story = { parameters: { api: { pending: true } }, render: () => <div className="flex justify-end p-6"><NotificationDropdown /></div>, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: /Study reminders, \d+ new/ }));
  const heading = await within(document.body).findByText("Reminders");
  await waitFor(() => expect(heading).toBeVisible());
} };
export const AccountMenu: Story = { render: () => <SidebarProvider><Sidebar><div className="mt-auto p-2"><UserDropdown /></div></Sidebar></SidebarProvider>, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Account menu" }));
  await waitFor(() => expect(within(document.body).getByRole("menuitem", { name: /Sign out/ })).toBeVisible());
} };
