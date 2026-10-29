import type { Meta, StoryObj } from "@storybook/nextjs-vite";

const meta = { title: "Design/Foundations" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Typography: Story = { render: () => <div className="space-y-4"><h1 className="font-display text-4xl font-bold">Plan study time that fits.</h1><p className="font-sans">Inter carries the interface text and your coursework.</p><p className="font-mono tabular-nums">IBM Plex Mono · 09:30 · 120 minutes</p></div> };
export const Colors: Story = { render: () => <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{["background", "card", "muted", "primary", "secondary", "destructive", "surplus", "deficit"].map((token) => <div key={token}><div className="h-20 rounded-lg border" style={{ background: `var(--${token})` }} /><p className="mt-2 text-sm">{token}</p></div>)}</div> };
