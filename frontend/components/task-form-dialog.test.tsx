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
