import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";


const meta = { title: "UI/Scroll-area", component: ScrollArea, args: {  } } satisfies Meta<typeof ScrollArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = { render: () => <ScrollArea className="h-48 w-64 rounded-lg border"><ul className="divide-y p-4">{Array.from({ length: 20 }, (_, i) => <li key={i} className="py-2">Academic task {i + 1}</li>)}</ul></ScrollArea> };
export const Horizontal: Story = { render: () => <ScrollArea className="w-64 rounded-lg border"><div className="flex w-max gap-6 p-4">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div><ScrollBar orientation="horizontal" /></ScrollArea> };
