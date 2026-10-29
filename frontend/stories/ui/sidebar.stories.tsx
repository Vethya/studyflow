import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarInput, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge, SidebarFooter, SidebarSeparator, SidebarRail, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { expect, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Sidebar", component: SidebarProvider, args: {  } } satisfies Meta<typeof SidebarProvider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <SidebarProvider {...args}>
  <Sidebar collapsible="icon"><SidebarHeader><strong>StudyFlow</strong><SidebarInput aria-label="Search navigation" placeholder="Search" /></SidebarHeader><SidebarSeparator />
    <SidebarContent><SidebarGroup><SidebarGroupLabel>Workspace</SidebarGroupLabel><SidebarGroupContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive>Dashboard</SidebarMenuButton><SidebarMenuBadge>2</SidebarMenuBadge></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton>Calendar</SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent>
    <SidebarFooter>Alex Student</SidebarFooter><SidebarRail />
  </Sidebar><SidebarInset><header className="p-4"><SidebarTrigger /></header><p className="p-4">Your study workspace</p></SidebarInset>
</SidebarProvider>, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getAllByRole("button", { name: "Toggle Sidebar" }).find((button) => button.tabIndex === 0)!);
  await waitFor(() => expect(canvasElement.querySelector('[data-state="collapsed"]')).toBeInTheDocument());
} };
export const Collapsed: Story = { ...Default, args: { defaultOpen: false }, play: undefined };
