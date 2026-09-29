// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const SelectContext = React.createContext<{ value?: string; onValueChange?: (value: string) => void }>({});

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <SelectContext.Provider value={{ value, onValueChange }}><button type="button" aria-label="Select empty" onClick={() => onValueChange?.("")}>Empty</button>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: any) => {
    const context = React.useContext(SelectContext);
    return <button type="button" role="combobox" aria-controls="task-category-options" aria-expanded="false" {...props} onClick={() => context.onValueChange?.(context.value === "Assignment" ? "Reading" : "High")}>{children}</button>;
  },
  SelectValue: ({ children }: any) => <span>{typeof children === "function" ? children("value") : children}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <span>{children}</span>,
}));

import { TaskFormDialog } from "./task-form-dialog";

afterEach(cleanup);

it("updates category and priority through the public selectors", async () => {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.includes("/preview")) return Response.json({ available: false });
    writes.push(JSON.parse(init.body as string));
    return Response.json({
      id: "created", title: "Task", category: "reading", priority: "high", deadline_at: "2099-09-12T09:00:00Z",
      original_estimate_minutes: 60, planned_source: "original", planned_duration_minutes: 60,
      estimate_frozen: false, actual_duration_minutes: 0, remaining_duration_minutes: 60,
      status: "not_started", sessions_completed: 0, sessions_upcoming: 0,
      created_at: "2099-09-01T00:00:00Z", updated_at: "2099-09-01T00:00:00Z",
    });
  });
  render(<TaskFormDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  const selects = screen.getAllByRole("combobox");
  fireEvent.click(screen.getAllByRole("button", { name: "Select empty" })[0]);
  fireEvent.click(selects[0]);
  fireEvent.click(selects[1]);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Task" } });
  fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2099-09-12T09:00" } });
  fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
  await waitFor(() => expect(writes[0]).toMatchObject({ category: "reading", priority: "high" }));

  cleanup();
  render(<TaskFormDialog open task={{
    id: "frozen", title: "Frozen", category: "Assignment", priority: "Medium",
    deadline: "2099-09-12T09:00:00Z", originalEstimate: 60, plannedSource: "Adaptive",
    plannedDuration: 90, estimateFrozen: true, course: undefined, notes: undefined,
  } as any} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getAllByRole("combobox")[0]);
});
