import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Callout } from "@/components/ui/callout";


const meta = { title: "UI/Callout", component: Callout, args: { title: "Study plan updated", children: "Review the proposed changes before accepting." } } satisfies Meta<typeof Callout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Tones: Story = { render: (args) => <div className="space-y-3">{(["info", "warning", "danger", "success", "blocked"] as const).map((tone) => <Callout {...args} key={tone} tone={tone} title={tone} />)}</div> };
