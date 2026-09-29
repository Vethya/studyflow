// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const cancel = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, onOpenChange, children }: any) => open ? <div role="dialog"><button onClick={() => onOpenChange?.(true)}>Open event</button><button onClick={() => onOpenChange?.(false, { cancel })}>Close event</button>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ open, onConfirm }: any) => open ? <button onClick={onConfirm}>Discard changes</button> : null,
}));

import { TaskFormDialog } from "./task-form-dialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("covers task form root open/close events and dirty discard", () => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/preview")) return Response.json({ available: false });
    return Response.json({});
  });
  const changed = vi.fn();
  render(<TaskFormDialog open onOpenChange={changed} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Open event" }));
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(changed).toHaveBeenNthCalledWith(1, true);
  expect(changed).toHaveBeenNthCalledWith(2, false);

  cleanup();
  cancel.mockClear();
  const dirtyChanged = vi.fn();
  render(<TaskFormDialog open onOpenChange={dirtyChanged} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(cancel).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(dirtyChanged).toHaveBeenCalledWith(false);

  cleanup();
  const view = render(<TaskFormDialog open={false} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  view.rerender(<TaskFormDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  view.rerender(<TaskFormDialog open={false} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
});
