"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2 } from "lucide-react";
import { CATEGORIES, PRIORITIES } from "@/types/task";
import type { AcademicTask, Category, Priority, TaskFormData } from "@/types/task";
import { isoToLocalInput, localInputToIso, nowLocalInput } from "@/lib/datetime";
import { ApiError, tasks as tasksApi, scheduling } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { AdaptiveEstimateNote, LargeAdjustmentDialog } from "@/components/adaptive-estimate";
import { resolveEstimateSelection, resolvePreviewSelection } from "@/lib/api/adaptive-contract";
import type { AdaptiveEstimate } from "@/types/progress";

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create a new task; pass a task to edit it in place. */
  task?: AcademicTask | null;
  onSaved: (task: AcademicTask) => void;
}

type TaskFormState = Omit<TaskFormData, "course" | "notes" | "plannedSource"> & {
  course: string;
  notes: string;
  /** This form always makes an explicit source selection. */
  plannedSource: "Original" | "Adaptive";
};

const EMPTY: TaskFormState = {
  title: "",
  category: "Assignment" as Category,
  priority: "Medium" as Priority,
  deadline: "",
  originalEstimate: 60,
  plannedSource: "Original",
  course: "",
  notes: "",
};

export function TaskFormDialog({ open, onOpenChange, task, onSaved }: TaskFormDialogProps) {
  const [form, setForm] = useState(EMPTY);
  /**
   * SPEC §15.4 / §15.6: the student's own history may suggest a very different
   * duration. The explanation is always shown; the acknowledgment dialog only
   * blocks the first time a category swings beyond 2× or below 0.5×.
   */
  const [estimate, setEstimate] = useState<AdaptiveEstimate | null>(null);
  /** Whether the current category/original pair may adopt a preview default. */
  const [applyPreviewDefault, setApplyPreviewDefault] = useState(true);
  const [ackOpen, setAckOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = Boolean(task);
  // The backend freezes the original estimate once work has started, so the
  // field is locked rather than letting the save fail with a 409.
  const estimateFrozen = isEditing && task?.status !== "Not Started";

  // Reset the fields whenever the dialog opens, or the task being edited
  // changes while it is open. Adjusting during render rather than in an effect
  // avoids showing the previous task's values for one frame.
  const [session, setSession] = useState<{ open: boolean; task?: AcademicTask | null }>({
    open: false,
  });
  if (open && (session.open !== open || session.task !== task)) {
    setSession({ open, task });
    setError(null);
    setEstimate(null);
    setApplyPreviewDefault(!task);
    setForm(
      task
        ? {
            title: task.title,
            category: task.category,
            priority: task.priority,
            deadline: isoToLocalInput(task.deadline),
            originalEstimate: task.originalEstimate,
            plannedSource: task.plannedSource,
            course: task.course ?? "",
            notes: task.notes ?? "",
          }
        : EMPTY,
    );
  } else if (!open && session.open) {
    setSession({ open: false });
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const minutes = Number(form.originalEstimate);

    // Resolve rather than branch so both preview outcomes use the same stale
    // response guard below.
    const request =
      minutes > 0
        ? scheduling.getAdaptiveEstimate(form.category, minutes, controller.signal)
        : Promise.resolve(null);

    request
      .then((next) => {
        if (controller.signal.aborted) return;
        setEstimate(next);
        // Existing tasks keep their explicit source. A fresh or deliberately
        // changed category/original pair may adopt the safe preview default.
        setForm((current) => ({
          ...current,
          ...resolvePreviewSelection(
            current.originalEstimate,
            next,
            current.plannedSource,
            applyPreviewDefault,
          ),
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEstimate(null);
          setForm((current) => ({
            ...current,
            ...resolvePreviewSelection(
              current.originalEstimate,
              null,
              current.plannedSource,
              applyPreviewDefault,
            ),
          }));
        }
      });

    return () => controller.abort();
  }, [open, form.category, form.originalEstimate, applyPreviewDefault]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Ask before using a first-time large adjustment (SPEC §15.4).
    const adaptivePreviewMatchesForm =
      estimate?.category === form.category &&
      estimate.originalEstimate === Number(form.originalEstimate);
    if (form.plannedSource === "Adaptive" && !adaptivePreviewMatchesForm) {
      setError("Adaptive planning is still being checked. Try again in a moment.");
      return;
    }

    if (form.plannedSource === "Adaptive" && estimate?.needsAcknowledgment) {
      setAckOpen(true);
      return;
    }

    setIsSaving(true);

    const payload: TaskFormData = {
      title: form.title,
      category: form.category,
      priority: form.priority,
      deadline: localInputToIso(form.deadline),
      // The selected source tells the backend whether its adaptive snapshot
      // should drive planning. Original remains the student's entered value.
      originalEstimate: Number(form.originalEstimate),
      plannedSource: form.plannedSource,
      course: form.course || undefined,
      notes: form.notes || undefined,
    };

    try {
      const saved = task
        ? await tasksApi.updateTask(task.id, payload)
        : await tasksApi.createTask(payload);
      onSaved(saved);
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError("This task has already been started, so its estimate can no longer change.");
      } else {
        setError(describeError(cause));
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit task" : "Add task"}</DialogTitle>
          <DialogDescription>
            Deadlines are stored as absolute moments, interpreted in your timezone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="task-title" className="text-xs font-medium">Title</Label>
            <Input
              id="task-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
              disabled={isSaving}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => {
                  if (!v) return;
                  setEstimate(null);
                  setApplyPreviewDefault(true);
                  setForm({ ...form, category: v as Category, plannedSource: "Original" });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => v && setForm({ ...form, priority: v as Priority })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>{priority}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-deadline" className="text-xs font-medium">Deadline</Label>
              <Input
                id="task-deadline"
                type="datetime-local"
                value={form.deadline}
                min={nowLocalInput()}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                disabled={isSaving}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-estimate" className="text-xs font-medium">
                Estimate (minutes)
              </Label>
              <Input
                id="task-estimate"
                type="number"
                min={1}
                value={form.originalEstimate}
                onChange={(e) => {
                  setEstimate(null);
                  setApplyPreviewDefault(true);
                  setForm({
                    ...form,
                    originalEstimate: Number(e.target.value),
                    plannedSource: "Original",
                  });
                }}
                disabled={isSaving || estimateFrozen}
                required
              />
              {estimateFrozen && (
                <p className="text-[11px] text-muted-foreground">
                  Frozen — this task has already been started.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-course" className="text-xs font-medium">Course (optional)</Label>
            <Input
              id="task-course"
              value={form.course}
              onChange={(e) => setForm({ ...form, course: e.target.value })}
              maxLength={100}
              disabled={isSaving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-notes" className="text-xs font-medium">Notes (optional)</Label>
            <Textarea
              id="task-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              maxLength={2000}
              rows={3}
              disabled={isSaving}
            />
          </div>

          {estimate && (
            <AdaptiveEstimateNote
              estimate={{
                ...estimate,
                plannedDuration:
                  form.plannedSource === "Adaptive"
                    ? estimate.adaptiveEstimate
                    : Number(form.originalEstimate),
                plannedSource: form.plannedSource,
              }}
              onChoose={
                estimate.needsAcknowledgment
                  ? undefined
                  : (which) => {
                      setApplyPreviewDefault(false);
                      setForm((current) => ({
                        ...current,
                        ...resolveEstimateSelection(current.originalEstimate, estimate, which),
                      }));
                    }
              }
            />
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save changes" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <LargeAdjustmentDialog
        estimate={estimate}
        open={ackOpen}
        onOpenChange={setAckOpen}
        onDecided={(which) => {
          setApplyPreviewDefault(false);
          setEstimate((current) =>
            current ? { ...current, needsAcknowledgment: false } : current,
          );
          setForm((current) => ({
            ...current,
            ...resolveEstimateSelection(current.originalEstimate, estimate, which),
          }));
        }}
      />
    </Dialog>
  );
}
