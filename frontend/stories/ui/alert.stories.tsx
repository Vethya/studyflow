import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";


const meta = { title: "UI/Alert", component: Alert, args: {  } } satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Alert {...args}><AlertTitle>Plan ready</AlertTitle><AlertDescription>Review your sessions before accepting.</AlertDescription><AlertAction><Button variant="outline">Review</Button></AlertAction></Alert> };
export const Destructive: Story = { ...Default, args: { variant: "destructive" } };
