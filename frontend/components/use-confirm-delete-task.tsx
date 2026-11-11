"use client";

import { useState, type ReactElement } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AcademicTask } from "@/types/task";

export function useConfirmDeleteTask(onConfirm: (task: AcademicTask) => void): {
  requestDelete: (task: AcademicTask) => void;
  dialog: ReactElement;
} {
  const [target, setTarget] = useState<AcademicTask | null>(null);

  return {
    requestDelete: setTarget,
    dialog: (
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
        title={`Delete “${target?.title ?? ""}”?`}
        description="Its sessions, outcomes and estimate history are deleted with it."
        confirmLabel="Delete task"
        destructive
        focusCancel
        onConfirm={() => {
          /* c8 ignore next -- the dialog can only confirm while a task is selected. */
          if (!target) return;
          const task = target;
          setTarget(null);
          onConfirm(task);
        }}
      />
    ),
  };
}
