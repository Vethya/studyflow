import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";


const meta = { title: "UI/Label", component: Label, args: { children: "Course", htmlFor: "course" } } satisfies Meta<typeof Label>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <div className="space-y-2"><Label {...args} /><Input id="course" placeholder="PSY101" /></div> };
