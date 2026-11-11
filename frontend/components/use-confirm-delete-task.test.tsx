import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConfirmDeleteTask } from "./use-confirm-delete-task";
import type { AcademicTask } from "@/types/task";

const task: AcademicTask = {
  id: "task-1",
  title: "Read algorithms",
  category: "Reading",
  deadline: "2026-10-02T12:00:00Z",
  priority: "High",
  originalEstimate: 120,
  plannedSource: "Original",
  plannedDuration: 120,
  actualDuration: 30,
  remainingDuration: 90,
  status: "In Progress",
  sessionsCompleted: 1,
  sessionsUpcoming: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-20T00:00:00Z",
};

function Harness({ onConfirm }: { onConfirm: (task: AcademicTask) => void }) {
  const { requestDelete, dialog } = useConfirmDeleteTask(onConfirm);
  return <><button onClick={() => requestDelete(task)}>Delete</button>{dialog}</>;
}

afterEach(cleanup);

describe("useConfirmDeleteTask", () => {
  it("explains deletion, focuses Cancel, and cancels without confirming", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Read algorithms”?" });
    expect(screen.getByText("Its sessions, outcomes and estimate history are deleted with it.")).toBeTruthy();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms the selected task once and closes the dialog", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    const confirm = screen.getByRole("button", { name: "Delete task" });
    expect(confirm.getAttribute("data-variant")).toBe("destructive");
    fireEvent.click(confirm);
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("dismisses with Escape and can request deletion again", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledExactlyOnceWith(task));
  });
});
