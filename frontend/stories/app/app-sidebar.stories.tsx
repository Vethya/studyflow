import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";

const meta = { title: "App/app-sidebar", component: AppSidebar, parameters: { app: true }, args: {  } } satisfies Meta<typeof AppSidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = { parameters: { nextjs: { navigation: { pathname: "/dashboard" } } }, render: () => <SidebarProvider><AppSidebar /><SidebarInset><SidebarTrigger /><p className="p-6">Dashboard</p></SidebarInset></SidebarProvider> };
export const Collapsed: Story = { render: () => <SidebarProvider defaultOpen={false}><AppSidebar /><SidebarInset><SidebarTrigger /></SidebarInset></SidebarProvider> };
