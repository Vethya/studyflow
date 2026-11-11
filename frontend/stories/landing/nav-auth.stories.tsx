import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NavAuth } from "@/components/landing/nav-auth";

const meta = {
  title: "Landing/nav-auth",
  component: NavAuth,
  parameters: { app: true, api: { authenticated: false } },
  decorators: [(Story) => <div className="rounded-xl bg-slate-700 p-4"><Story /></div>],
} satisfies Meta<typeof NavAuth>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SignedOut: Story = {};
export const SignedIn: Story = { parameters: { api: { authenticated: true } } };
