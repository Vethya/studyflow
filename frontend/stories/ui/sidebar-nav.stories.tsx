import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LayoutDashboard, Calendar } from "@/components/icons";
import { SidebarNav } from "@/components/ui/sidebar-nav";


const meta = { title: "UI/Sidebar-nav", component: SidebarNav, args: { items: [{ title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" }, { title: "Calendar", icon: Calendar, url: "/calendar" }], ariaLabel: "Study navigation" } } satisfies Meta<typeof SidebarNav>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { parameters: { nextjs: { navigation: { pathname: "/dashboard" } } } };
export const Compact: Story = { ...Default, args: { size: "sm", orientation: "responsive" } };
