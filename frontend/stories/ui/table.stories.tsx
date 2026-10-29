import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption, TableFooter } from "@/components/ui/table";


const meta = { title: "UI/Table", component: Table, args: {  } } satisfies Meta<typeof Table>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Table><TableCaption>Coursework for this week</TableCaption><TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Remaining</TableHead><TableHead>Priority</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Read cognitive science paper</TableCell><TableCell>2 hours</TableCell><TableCell>High</TableCell></TableRow><TableRow><TableCell>Draft essay</TableCell><TableCell>1 hour</TableCell><TableCell>Medium</TableCell></TableRow></TableBody><TableFooter><TableRow><TableCell colSpan={3}>3 hours of remaining work</TableCell></TableRow></TableFooter></Table> };
export const Empty: Story = { render: () => <Table><TableBody><TableRow><TableCell>No coursework yet</TableCell></TableRow></TableBody></Table> };
