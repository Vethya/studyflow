import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";


const meta = { title: "UI/Card", component: Card, args: {  } } satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Card {...args} className="max-w-md"><CardHeader><CardTitle>Weekly capacity</CardTitle><CardDescription>Your coursework against available hours.</CardDescription><CardAction><Button variant="ghost">Edit</Button></CardAction></CardHeader><CardContent>8 hours available, 6 hours committed.</CardContent><CardFooter>2 hours remaining</CardFooter></Card> };
