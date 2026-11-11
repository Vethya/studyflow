import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Page from "@/app/terms/page";
const meta = { title: "Pages/public/terms", component: Page, parameters: { app: true, layout: "fullscreen", api: { authenticated: false } } } satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
