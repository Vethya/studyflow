import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "@/components/ui/badge";


const meta = { title: "UI/Badge", component: Badge, args: { children: "In progress" } } satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Variants: Story = { render: (args) => <div className="flex gap-3">{(["default", "secondary", "destructive", "outline", "ghost", "link"] as const).map((variant) => <Badge {...args} key={variant} variant={variant}>{variant}</Badge>)}</div> };
