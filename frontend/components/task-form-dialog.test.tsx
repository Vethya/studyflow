// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskFormDialog } from "./task-form-dialog";
import { toAcademicTask } from "@/lib/api/mappers";

const wire = {
  id: "task-1", title: "Reading", category: "assignment" as const,
  priority: "medium" as const, course: "Math", notes: "Keep notes",
  deadline_at: "2099-09-12T09:00:00Z", original_estimate_minutes: 60,
  adaptive_estimate_minutes: 90, planned_source: "adaptive" as const,
  planned_duration_minutes: 90, estimate_frozen: true,
  created_at: "2026-09-04T09:00:00Z", updated_at: "2026-09-04T09:00:00Z",
  status: "overdue" as const,
};
const preview = {
  category: "assignment", original_minutes: 60, adaptive_minutes: 90,
  planned_minutes: 90, correction_factor: "1.5", history_scope: "category",
  history_count: 6, available: true, planned_source: "adaptive",
  acknowledgment_required: false,
};
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["unavailable", "failed", "acknowledgment required"])("saves frozen Adaptive title edits with %s live preview without changing its snapshot", async (mode) => {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "PUT") {
      writes.push(JSON.parse(init.body as string));
      return Response.json({ ...wire, title: "Updated title" });
    }
    if (mode === "failed") throw new Error("offline");
    return Response.json({ ...preview, available: mode !== "unavailable", acknowledgment_required: true });
  });
  const saved = vi.fn();
  const task = toAcademicTask(wire);
  expect(task.estimateFrozen).toBe(true);
  render(<TaskFormDialog open task={task} onOpenChange={() => {}} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated title" } });
  fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(writes).toEqual([expect.objectContaining({ title: "Updated title", original_estimate_minutes: 60, planned_source: "adaptive", notes: "Keep notes" })]);
  expect(writes[0]).not.toHaveProperty("adaptive_estimate_minutes");
  expect(writes[0]).not.toHaveProperty("planned_duration_minutes");
  expect(screen.getByText("Your saved task plan")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Suggested/ })).toBeNull();
  expect((screen.getByLabelText("Estimate (minutes)") as HTMLInputElement).disabled).toBe(true);
});

it("does not mistake an overdue but unfrozen task for a saved snapshot", async () => {
  vi.stubGlobal("fetch", async () => Response.json(preview));
  const task = toAcademicTask({ ...wire, estimate_frozen: false });
  expect(task.estimateFrozen).toBe(false);
  render(<TaskFormDialog open task={task} onOpenChange={() => {}} onSaved={() => {}} />);
  expect((screen.getByLabelText("Estimate (minutes)") as HTMLInputElement).disabled).toBe(false);
  expect(await screen.findByRole("button", { name: /Suggested/ })).toBeTruthy();
});

it.each([false, true])("refreshes an adaptive conflict, retains entered fields, and retries (new acknowledgment=%s)", async (needsAck) => {
  let previews = 0;
  const writes: Record<string, unknown>[] = [];
  let acknowledged = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.includes("/preview")) {
      previews++;
      return Response.json(previews === 1 ? preview : { ...preview, available: needsAck, adaptive_minutes: 180, planned_minutes: 60, correction_factor: "3.0", planned_source: "original", acknowledgment_required: needsAck });
    }
    if (url.includes("/acknowledgments")) {
      acknowledged = true;
      return new Response(null, { status: 204 });
    }
    writes.push(JSON.parse(init.body as string));
    return writes.length === 1
      ? Response.json({ detail: { code: "adaptive_estimate_conflict", message: "Adaptive planning changed. Refresh and choose your estimate or acknowledge the updated suggestion." } }, { status: 409 })
      : Response.json(wire);
  });
  const saved = vi.fn();
  render(<TaskFormDialog open onOpenChange={() => {}} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My draft" } });
  fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "Do not lose" } });
  fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2099-09-12T09:00" } });
  await waitFor(() => expect(screen.getByRole("button", { name: /Suggested/ }).getAttribute("aria-pressed")).toBe("true"));
  const submit = () => fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
  submit();
  await waitFor(() => expect(previews).toBeGreaterThan(1));
  expect(screen.queryByText(/already been started/)).toBeNull();
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("My draft");
  expect((screen.getByLabelText("Estimate (minutes)") as HTMLInputElement).value).toBe("60");
  if (needsAck) {
    fireEvent.click(await screen.findByRole("button", { name: /Suggested/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use 3h" }));
    await waitFor(() => expect(acknowledged).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Use 3h" })).toBeNull());
  }
  submit();
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(writes[1]).toMatchObject({ title: "My draft", notes: "Do not lose", original_estimate_minutes: 60, planned_source: needsAck ? "adaptive" : "original" });
});

it("creates a task, exercises category and priority choices, and preserves optional fields", async () => {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.includes("/preview")) return Response.json({ ...preview, available: false });
    writes.push(JSON.parse(init.body as string));
    return Response.json({ ...wire, id: "created", title: "New task", category: "reading", priority: "high" });
  });
  const saved = vi.fn();
  const closed = vi.fn();
  render(<TaskFormDialog open onOpenChange={closed} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New task" } });
  fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2099-09-12T09:00" } });
  fireEvent.change(screen.getByLabelText("Course (optional)"), { target: { value: "Algorithms" } });
  fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "Read twice" } });

  const selects = screen.getAllByRole("combobox");
  fireEvent.click(selects[0]);
  fireEvent.click(await screen.findByText("Reading"));
  fireEvent.click(selects[1]);
  fireEvent.click(await screen.findByText("High"));

  fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(writes[0]).toMatchObject({ title: "New task", category: "assignment", priority: "medium", course: "Algorithms", notes: "Read twice" });
  expect(closed).toHaveBeenCalledWith(false);
});

it("guards adaptive source mismatches and reports ordinary conflicts", async () => {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.includes("/preview")) return Response.json(preview);
    if (init.method === "PUT") {
      return Response.json({ detail: { code: "conflict", message: "task changed elsewhere" } }, { status: 409 });
    }
    return Response.json(wire);
  });
  const taskToEdit = toAcademicTask({ ...wire, estimate_frozen: false });
  render(<TaskFormDialog open task={taskToEdit} onOpenChange={() => {}} onSaved={() => {}} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Suggested/ })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Your estimate/ }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
  fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
  await waitFor(() => expect(screen.getByText("task changed elsewhere")).toBeTruthy());
});

it("asks before closing a dirty form and discards it on confirmation", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ...preview, available: false }));
  const closed = vi.fn();
  render(<TaskFormDialog open onOpenChange={closed} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
  fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
  expect(closed).toHaveBeenCalledWith(false);
});

it("blocks an adaptive save when the live preview no longer matches", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/preview")) return Response.json(preview);
    throw new Error("save should not run");
  });
  const task = toAcademicTask({ ...wire, category: "reading", planned_source: "adaptive", estimate_frozen: false });
  render(<TaskFormDialog open task={task} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Suggested/ })).toBeTruthy());
  fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
  expect(await screen.findByText("Adaptive planning is still being checked. Try again in a moment.")).toBeTruthy();
});

it("asks for acknowledgment before saving a large adaptive adjustment", async () => {
  const closed = vi.fn();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("/preview")) return Response.json({ ...preview, adaptive_minutes: 180, planned_minutes: 180, correction_factor: "3.0", acknowledgment_required: true });
    if (url.includes("/acknowledgments")) return new Response(null, { status: 204 });
    if (init?.method === "PUT") return Response.json(wire);
    return Response.json(wire);
  });
  const task = toAcademicTask({ ...wire, estimate_frozen: false, planned_source: "adaptive" });
  render(<TaskFormDialog open task={task} onOpenChange={closed} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Suggested/ })).toBeTruthy());
  fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
  expect(await screen.findByText(/usually takes much longer/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
  expect(closed).not.toHaveBeenCalled();
});

it("closes a clean form and reports ordinary save failures", async () => {
  const closed = vi.fn();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("/preview")) return Response.json({ ...preview, available: false });
    if (init?.method === "POST") throw new Error("save failed");
    return Response.json(wire);
  });
  render(<TaskFormDialog open onOpenChange={closed} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(closed).toHaveBeenCalledWith(false);

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
  fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2099-09-12T09:00" } });
  fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
  expect(await screen.findByText("save failed")).toBeTruthy();
});

it("updates the estimate through the input and closes a clean form", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/preview")) return Response.json({ ...preview, available: false });
    return Response.json(wire);
  });
  const closed = vi.fn();
  render(<TaskFormDialog open onOpenChange={closed} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Estimate (minutes)"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
  expect(closed).toHaveBeenCalledWith(false);
});

it("keeps the estimate unset when the live preview fails", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/preview")) throw new Error("preview unavailable");
    return Response.json(wire);
  });
  render(<TaskFormDialog open onOpenChange={() => {}} onSaved={() => {}} />);
  await waitFor(() => expect(screen.queryByRole("button", { name: /Suggested/ })).toBeNull());
});
