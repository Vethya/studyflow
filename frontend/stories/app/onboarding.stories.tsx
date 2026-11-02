import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarGuide } from "@/components/onboarding";
import { SidebarProvider, Sidebar, SidebarContent } from "@/components/ui/sidebar";

const meta = { title: "App/onboarding", component: SidebarGuide, parameters: { app: true } } satisfies Meta<typeof SidebarGuide>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InSidebar: Story = { render: () => <SidebarProvider><Sidebar><SidebarContent><SidebarGuide /></SidebarContent></Sidebar></SidebarProvider> };
export const CollapsedSidebar: Story = { render: () => <SidebarProvider defaultOpen={false}><Sidebar collapsible="icon"><SidebarContent><SidebarGuide /></SidebarContent></Sidebar></SidebarProvider> };
