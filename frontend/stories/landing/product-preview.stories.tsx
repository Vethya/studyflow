import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProductPreview } from "@/components/landing/product-preview";
import { CapacityBar } from "@/components/capacity-bar";
import { demoCapacity } from "@/components/landing/demo-data";

const meta = {
  title: "Landing/product-preview",
  component: ProductPreview,
  args: {
    label: "This week: 18 hours of coursework, 14 hours available, 4 hours short.",
    children: <div className="p-6"><CapacityBar {...demoCapacity} /></div>,
  },
  decorators: [(Story) => <div className="landing-canvas max-w-xl p-4"><Story /></div>],
} satisfies Meta<typeof ProductPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
