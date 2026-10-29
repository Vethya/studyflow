import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage, BreadcrumbEllipsis } from "@/components/ui/breadcrumb";


const meta = { title: "UI/Breadcrumb", component: Breadcrumb, args: {  } } satisfies Meta<typeof Breadcrumb>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbEllipsis /></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Reading task</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb> };
