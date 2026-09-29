// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "./avatar";
import { Badge } from "./badge";
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./breadcrumb";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Callout } from "./callout";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "./command";
import { ConfirmDialog } from "./confirm-dialog";
import { PlanGenerationDialog } from "../plan-generation-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./dropdown-menu";
import { FieldError } from "./field-error";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, InputGroupTextarea } from "./input-group";
import { Input } from "./input";
import { Label } from "./label";
import { PasswordInput } from "./password-input";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "./popover";
import { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue } from "./progress";
import { ScrollArea, ScrollBar } from "./scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue } from "./select";
import { Separator } from "./separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "./sheet";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar } from "./sidebar";
import { SidebarNav } from "./sidebar-nav";
import { Skeleton } from "./skeleton";
import { Slider } from "./slider";
import { SlidingIndicator, useSlidingIndicator } from "./sliding-indicator";
import { Switch } from "./switch";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Textarea } from "./textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { ChartContainer, ChartLegendContent, ChartStyle, ChartTooltipContent } from "./chart";

vi.mock("next/navigation", () => ({ usePathname: () => "/tasks/active" }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive">{children}</div>,
  Tooltip: () => null,
  Legend: () => null,
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function IndicatorProbe({ active }: { active: boolean }) {
  const { containerRef, indicator } = useSlidingIndicator<HTMLDivElement>({ activeKey: active });
  return <div ref={containerRef}><button data-active={active ? "true" : undefined}>Active</button><SlidingIndicator indicator={indicator} /></div>;
}

describe("presentational UI primitives", () => {
  it("renders content, variants, slots, and custom classes", () => {
    render(
      <div>
        <Alert variant="default"><AlertTitle>Title</AlertTitle><AlertDescription>Description</AlertDescription><AlertAction>Action</AlertAction></Alert>
        <Alert variant="destructive">Bad</Alert>
        <Avatar size="sm"><AvatarImage src="/avatar.png" /><AvatarFallback>AB</AvatarFallback><AvatarBadge /></Avatar>
        <AvatarGroup><Avatar><AvatarFallback>A</AvatarFallback></Avatar><AvatarGroupCount>+2</AvatarGroupCount></AvatarGroup>
        {(["default", "secondary", "destructive", "outline", "ghost", "link"] as const).map((variant) => <Badge key={variant} variant={variant}>{variant}</Badge>)}
        <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbEllipsis /></BreadcrumbItem><BreadcrumbItem><BreadcrumbPage>Current</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
        {(["default", "outline", "secondary", "ghost", "destructive", "link"] as const).map((variant) => <Button key={variant} variant={variant}>{variant}</Button>)}
        {(["info", "warning", "danger", "success", "blocked"] as const).map((tone) => <Callout key={tone} tone={tone} title={tone} actions={<Button>Action</Button>}>Body</Callout>)}
        <Card><CardHeader><CardTitle>Card</CardTitle><CardDescription>Desc</CardDescription><CardAction>Action</CardAction></CardHeader><CardContent>Content</CardContent><CardFooter>Footer</CardFooter></Card>
        <FieldError id="error" message="Required" />
        <FieldError id="empty" message={null} />
        <Input aria-label="Input" /><Label htmlFor="input">Label</Label><Textarea aria-label="Textarea" />
        <Separator /><Skeleton /><Switch size="sm" /><Switch /><Slider defaultValue={[25, 75]} /><Slider value={[10, 20]} /><Slider min={10} max={20} /><Progress value={50}><ProgressLabel>Progress</ProgressLabel><ProgressValue /><ProgressTrack><ProgressIndicator /></ProgressTrack></Progress>
        <Table><TableCaption>Caption</TableCaption><TableHeader><TableRow><TableHead>Head</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Cell</TableCell></TableRow></TableBody><TableFooter><TableRow><TableCell>Foot</TableCell></TableRow></TableFooter></Table>
      </div>,
    );
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Current").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.queryByText("empty")).toBeNull();
  });

  it("toggles password visibility and focuses input-group controls", () => {
    render(<div><PasswordInput aria-label="Password" /><InputGroup><InputGroupAddon align="inline-start">$</InputGroupAddon><InputGroupInput aria-label="Group input" /><InputGroupAddon align="inline-end"><InputGroupButton>Go</InputGroupButton></InputGroupAddon><InputGroupText>Text</InputGroupText><InputGroupTextarea aria-label="Group textarea" /></InputGroup></div>);
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password.type).toBe("password");
    fireEvent.click(screen.getByText("$"));
    expect(document.activeElement).toBe(screen.getByLabelText("Group input"));
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
  });
});

describe("interactive primitive wrappers", () => {
  it("renders dialog, confirmation, popover, sheet, collapsible, and tooltip", () => {
    render(<div>
      <Dialog open><DialogTrigger>Open dialog</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Dialog title</DialogTitle><DialogDescription>Dialog description</DialogDescription></DialogHeader><DialogFooter showCloseButton>Footer</DialogFooter></DialogContent></Dialog>
      <ConfirmDialog open onOpenChange={vi.fn()} title="Confirm" description="Sure?" confirmLabel="Confirm action" onConfirm={vi.fn()}>Extra</ConfirmDialog>
      <PlanGenerationDialog open />
      <Popover open><PopoverTrigger>Open popover</PopoverTrigger><PopoverContent><PopoverHeader><PopoverTitle>Popover title</PopoverTitle><PopoverDescription>Popover description</PopoverDescription></PopoverHeader></PopoverContent></Popover>
      <Sheet open><SheetTrigger>Open sheet</SheetTrigger><SheetContent side="left"><SheetHeader><SheetTitle>Sheet title</SheetTitle><SheetDescription>Sheet description</SheetDescription></SheetHeader><SheetFooter><SheetClose>Close sheet</SheetClose>Footer</SheetFooter></SheetContent></Sheet>
      <Collapsible open><CollapsibleTrigger>Toggle</CollapsibleTrigger><CollapsibleContent>Collapsible content</CollapsibleContent></Collapsible>
      <TooltipProvider><Tooltip open><TooltipTrigger>Hover</TooltipTrigger><TooltipContent>Tooltip content</TooltipContent></Tooltip></TooltipProvider>
    </div>);
    expect(screen.getByText("Dialog title")).toBeTruthy();
    expect(screen.getByText("Confirm action")).toBeTruthy();
    expect(screen.getByText("Popover title")).toBeTruthy();
    expect(screen.getByText("Sheet title")).toBeTruthy();
    expect(screen.getByText("Collapsible content")).toBeTruthy();
    expect(screen.getByText("Tooltip content")).toBeTruthy();
  });

  it("confirms and cancels through the confirmation dialog", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Confirm" confirmLabel="Confirm action" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores a second confirm while the first async action is pending", async () => {
    let resolve: (() => void) | undefined;
    const onConfirm = vi.fn(() => new Promise<void>((finish) => { resolve = finish; }));
    render(<ConfirmDialog open onOpenChange={vi.fn()} title="Confirm" confirmLabel="Confirm action" onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: "Confirm action" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.submit(confirm.closest("form")!);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await act(async () => { resolve?.(); });
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
  });

  it("covers command, menu, select, tabs, calendar, scroll area, and chart content", () => {
    render(<div>
      <Command><CommandInput placeholder="Search" /><CommandList><CommandEmpty>Nothing</CommandEmpty><CommandGroup heading="Group"><CommandItem>One<CommandShortcut>⌘1</CommandShortcut></CommandItem></CommandGroup><CommandSeparator /></CommandList></Command>
      <CommandDialog open onOpenChange={() => undefined}><Command><CommandInput /><CommandList><CommandItem>Dialog item</CommandItem></CommandList></Command></CommandDialog>
      <DropdownMenu open><DropdownMenuTrigger>Menu</DropdownMenuTrigger><DropdownMenuPortal><DropdownMenuContent><DropdownMenuGroup><DropdownMenuLabel inset>Menu label</DropdownMenuLabel><DropdownMenuItem inset>Item<DropdownMenuShortcut>⌘I</DropdownMenuShortcut></DropdownMenuItem><DropdownMenuItem variant="destructive">Delete</DropdownMenuItem><DropdownMenuCheckboxItem checked>Checked</DropdownMenuCheckboxItem><DropdownMenuRadioGroup value="one"><DropdownMenuRadioItem value="one">Radio</DropdownMenuRadioItem></DropdownMenuRadioGroup><DropdownMenuSeparator /><DropdownMenuSub open><DropdownMenuSubTrigger inset>More</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Sub item</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub></DropdownMenuGroup></DropdownMenuContent></DropdownMenuPortal></DropdownMenu>
      <Select defaultValue="one"><SelectTrigger size="sm"><SelectValue placeholder="Pick" /></SelectTrigger><SelectContent><SelectScrollUpButton /><SelectGroup><SelectLabel>Options</SelectLabel><SelectItem value="one">One</SelectItem><SelectSeparator /><SelectItem value="two">Two</SelectItem></SelectGroup><SelectScrollDownButton /></SelectContent></Select>
      <Tabs defaultValue="one" orientation="vertical"><TabsList variant="line"><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one">Tab one</TabsContent><TabsContent value="two">Tab two</TabsContent></Tabs>
      <Calendar month={new Date("2026-09-01T00:00:00Z")} showWeekNumber captionLayout="dropdown" />
      <ScrollArea><p>Scrollable</p><ScrollBar orientation="horizontal" /></ScrollArea>
      <ChartStyle id="chart-1" config={{ a: { color: "red" }, b: { theme: { light: "blue", dark: "black" } } }} />
      <ChartContainer id="chart-1" config={{ a: { label: "Alpha", color: "red" }, b: { label: "Beta", theme: { light: "blue", dark: "black" } } }}><><div /><ChartTooltipContent active payload={[{ dataKey: "a", name: "A", value: 123, color: "red", graphicalItemId: "a", payload: { a: "a" } }]} label="a" /><ChartLegendContent payload={[{ dataKey: "a", value: "A", color: "red", type: "line" }]} /></></ChartContainer>
    </div>);
    expect(screen.getByText("Tab one")).toBeTruthy();
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    fireEvent.click(document.querySelector("[data-slot='select-trigger']")!);
  });
});

describe("sidebar and navigation primitives", () => {
  it("renders every sidebar slot and responds to controls", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<SidebarProvider defaultOpen>
      <Sidebar variant="floating" collapsible="icon"><SidebarHeader>Header</SidebarHeader><SidebarInput placeholder="Sidebar search" /><SidebarContent><SidebarGroup><SidebarGroupLabel>Group</SidebarGroupLabel><SidebarGroupAction aria-label="Group action" /><SidebarGroupContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive tooltip="Home">Home</SidebarMenuButton><SidebarMenuAction showOnHover aria-label="Menu action" /><SidebarMenuBadge>1</SidebarMenuBadge></SidebarMenuItem><SidebarMenuSkeleton showIcon /><SidebarMenuSub><SidebarMenuSubItem><SidebarMenuSubButton href="#" size="sm" isActive>Sub</SidebarMenuSubButton></SidebarMenuSubItem></SidebarMenuSub></SidebarMenu></SidebarGroupContent></SidebarGroup><SidebarSeparator /></SidebarContent><SidebarFooter>Footer</SidebarFooter><SidebarRail /></Sidebar><SidebarInset><SidebarTrigger /><Button>Content</Button></SidebarInset></SidebarProvider>);
    expect(screen.getByText("Header")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Toggle Sidebar/ })[1]);
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });

    cleanup();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<SidebarProvider><Sidebar collapsible="none">Always visible</Sidebar><Sidebar><SidebarHeader>Mobile header</SidebarHeader></Sidebar><SidebarInset><SidebarTrigger /></SidebarInset></SidebarProvider>);
    expect(screen.getByText("Always visible")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Toggle Sidebar/ }));
    expect(screen.getByText("Mobile header")).toBeTruthy();
    cleanup();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<SidebarProvider><Sidebar><SidebarContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip={{ children: "Object tip" }}>Object tip</SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarContent></Sidebar></SidebarProvider>);
    expect(screen.getByText("Object tip")).toBeTruthy();

    cleanup();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<SidebarProvider defaultOpen={false}><SidebarNav activeKey="explicit" items={[{ id: "collapsed", title: "Collapsed", icon: () => <span>Icon</span>, isActive: true }, { title: "No id", icon: () => <span>Icon</span>, isActive: false }]} /></SidebarProvider>);
    expect(screen.getByRole("button", { name: /Collapsed/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /No id/ })).toBeTruthy();

    cleanup();
    function OutsideSidebarProbe() {
      useSidebar();
      return null;
    }
    expect(() => render(<OutsideSidebarProbe />)).toThrow("useSidebar must be used");

    cleanup();
    function SidebarStateProbe() {
      const { setOpen } = useSidebar();
      return <button onClick={() => setOpen(true)}>Set sidebar open</button>;
    }
    render(<SidebarProvider><SidebarStateProbe /></SidebarProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Set sidebar open" }));
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });

    const onOpenChange = vi.fn();
    render(<SidebarProvider open onOpenChange={onOpenChange}><SidebarTrigger /></SidebarProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Toggle Sidebar/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders active and inactive navigation links and buttons", () => {
    render(<SidebarNav ariaLabel="Main navigation" orientation="responsive" size="sm" items={[{ title: "Tasks", url: "/tasks", match: "/", icon: () => <span>Icon</span> }, { id: "settings", title: "Settings", icon: () => <span>Icon</span>, isActive: false, onClick: vi.fn() }, { id: "custom", title: "Custom", icon: () => <span>Icon</span>, isActive: true, onClick: vi.fn() }, { id: "unlinked", title: "Unlinked", icon: () => <span>Icon</span> }]} />);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(screen.getByRole("link", { name: /Tasks/ }).getAttribute("aria-current")).toBe("page");

    cleanup();
    render(<SidebarNav size="sm" orientation="vertical" items={[{ title: "Vertical", icon: () => <span>Icon</span>, isActive: false }]} />);
    expect(screen.getByRole("button", { name: /Vertical/ })).toBeTruthy();

  });

  it("renders the sliding indicator only when ready", async () => {
    const { rerender } = render(<SlidingIndicator indicator={{ top: 1, left: 2, width: 3, height: 4, ready: false }} />);
    expect(document.querySelector("[aria-hidden='true']")).toBeNull();
    rerender(<SlidingIndicator indicator={{ top: 1, left: 2, width: 3, height: 4, ready: true }} />);
    expect(document.querySelector("[aria-hidden='true']")).toBeTruthy();

    cleanup();
    const probe = render(<IndicatorProbe active />);
    expect(document.querySelector("[aria-hidden='true']")).toBeTruthy();
    probe.rerender(<IndicatorProbe active={false} />);
    await waitFor(() => expect(document.querySelector("[aria-hidden='true']")).toBeNull());
  });
});
