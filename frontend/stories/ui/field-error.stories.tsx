import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";


const meta = { title: "UI/Field-error", component: FieldError, args: { id: "title-error", message: "Enter a task title." } } satisfies Meta<typeof FieldError>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Invalid: Story = { render: (args) => <div className="space-y-2"><Input aria-label="Task title" aria-invalid aria-describedby={args.id} /><FieldError {...args} /></div> };
export const NoError: Story = { args: { message: null } };
