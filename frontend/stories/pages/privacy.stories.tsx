import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/privacy/page";
const meta = { title: "Pages/public/privacy", component: Page, parameters: { app: true, layout: "fullscreen", api: { authenticated: false } } } satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
