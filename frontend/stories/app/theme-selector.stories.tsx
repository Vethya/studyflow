import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ThemeSelector, ThemeOptionIcon } from "@/components/theme-selector";

const meta = { title: "App/theme-selector", component: ThemeSelector, parameters: { app: true }, args: {  } } satisfies Meta<typeof ThemeSelector>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Selector: Story = {};
export const Icons: Story = { render: () => <div className="flex gap-4">{(["light", "dark", "amoled", "system"] as const).map((theme) => <span key={theme} className="flex gap-2"><ThemeOptionIcon theme={theme} />{theme}</span>)}</div> };
