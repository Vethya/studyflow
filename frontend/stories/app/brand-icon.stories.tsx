import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BrandIcon } from "@/components/brand-icon";

const meta = { title: "App/brand-icon", component: BrandIcon, args: {  } } satisfies Meta<typeof BrandIcon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Sizes: Story = { render: () => <div className="flex items-end gap-4"><BrandIcon className="size-5" /><BrandIcon /><BrandIcon className="size-16" /><span className="flex items-center gap-2.5 text-base font-semibold tracking-tight"><BrandIcon className="size-7" />StudyFlow</span></div> };
