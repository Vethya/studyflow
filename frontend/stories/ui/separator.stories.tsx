import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Separator } from "@/components/ui/separator";


const meta = { title: "UI/Separator", component: Separator, args: {  } } satisfies Meta<typeof Separator>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = { render: (args) => <div className="space-y-3"><p>Coursework</p><Separator {...args} /><p>Study sessions</p></div> };
export const Vertical: Story = { render: () => <div className="flex h-8 items-center gap-3">Tasks<Separator orientation="vertical" />Calendar</div> };
