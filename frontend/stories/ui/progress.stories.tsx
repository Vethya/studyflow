import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";


const meta = { title: "UI/Progress", component: Progress, args: { value: 60 } } satisfies Meta<typeof Progress>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Progress {...args} className="max-w-md"><ProgressLabel>Effort progress</ProgressLabel><ProgressValue /></Progress> };
export const Empty: Story = { ...Default, args: { value: 0 } };
export const Complete: Story = { ...Default, args: { value: 100 } };
export const Indeterminate: Story = { ...Default, args: { value: null } };
