import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Skeleton } from "@/components/ui/skeleton";


const meta = { title: "UI/Skeleton", component: Skeleton, args: { className: "h-5 w-64" } } satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const LoadingCard: Story = { render: () => <div role="status" aria-label="Loading tasks" className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-80" /><Skeleton className="h-24 w-80" /></div> };
