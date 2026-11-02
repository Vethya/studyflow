import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { CornerDownLeft } from "@/components/icons";

const meta = { title: "UI/Kbd", component: Kbd, args: { children: "N" } } satisfies Meta<typeof Kbd>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Combination: Story = { render: () => <p className="flex items-center gap-3 text-sm text-muted-foreground"><KbdGroup><Kbd>Ctrl</Kbd><Kbd>K</Kbd></KbdGroup> opens the menu <KbdGroup><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup> to move <Kbd><CornerDownLeft aria-hidden /></Kbd> to open</p> };
