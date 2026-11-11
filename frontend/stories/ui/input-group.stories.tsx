import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";


const meta = { title: "UI/Input-group", component: InputGroup, args: {  } } satisfies Meta<typeof InputGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Search: Story = { render: () => <InputGroup className="max-w-md"><InputGroupAddon><InputGroupText>Course</InputGroupText></InputGroupAddon><InputGroupInput aria-label="Search coursework" placeholder="Search…" /><InputGroupAddon align="inline-end"><InputGroupButton>Search</InputGroupButton></InputGroupAddon></InputGroup> };
export const Notes: Story = { render: () => <InputGroup className="max-w-md"><InputGroupTextarea aria-label="Task notes" placeholder="Add notes…" /><InputGroupAddon align="block-end"><InputGroupText>Plain text only</InputGroupText></InputGroupAddon></InputGroup> };
