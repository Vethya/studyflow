import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageShell, PageHeader, SectionHeader, SectionCard, FigureRow, Figure, EmptyState } from "@/components/page-kit";
import { Button } from "@/components/ui/button";

const meta = { title: "App/page-kit", component: PageShell, parameters: { app: true }, args: { children: null } } satisfies Meta<typeof PageShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Composition: Story = { render: () => <PageShell><PageHeader title="Your coursework" description="What needs doing and how much time it needs." actions={<Button>Add task</Button>} /><FigureRow><Figure label="Remaining work" value="6 hours" /><Figure label="Available" value="8 hours" tone="surplus" /><Figure label="Loading" value={null} /></FigureRow><SectionHeader title="Upcoming" meta="2 tasks" action={{ href: "/tasks", label: "See all" }} /><SectionCard title="Open work" description="Tasks with upcoming deadlines" footer="Updated just now"><p>Read cognitive science paper</p></SectionCard></PageShell> };
export const Empty: Story = { render: () => <EmptyState title="No coursework yet" action={<Button>Add task</Button>}>Add a task to start planning.</EmptyState> };
