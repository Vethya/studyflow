"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2 } from "@/components/icons";
import { CATEGORIES, PRIORITIES } from "@/types/task";
import type { AcademicTask, Category, Priority, TaskFormData } from "@/types/task";
import { addZonedDays, dayKey, isoToLocalInput, localInputToIso, nowLocalInput } from "@/lib/datetime";
import { ApiError, tasks as tasksApi, scheduling } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { AdaptiveEstimateNote, LargeAdjustmentDialog, PersistedEstimateNote } from "@/components/adaptive-estimate";
import {
  resolveEstimateChoiceAction,
  resolveEstimateSelection,
  resolvePreviewSelection,
} from "@/lib/api/adaptive-contract";
import type { AdaptiveEstimate } from "@/types/progress";
import { adaptiveEstimateKey } from "@/lib/swr-keys";
import { useAccountTimezone } from "@/hooks/use-account-timezone";

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

/** A new task starts due at the end of the day a week from now, a common hand-in gap. */
function emptyForm(timeZone: string): TaskFormState {
  return {
    title: "",
    category: "Assignment" as Category,
    priority: "Medium" as Priority,
    deadline: `${dayKey(addZonedDays(new Date(), 7, timeZone), timeZone)}T23:59`,
    originalEstimate: 60,
    plannedSource: "Original",
    course: "",
    notes: "",
  };
}

type FieldErrors = Partial<Record<"title" | "deadline" | "estimate", string>>;

function validate(form: TaskFormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.title.trim()) errors.title = "Give the task a name.";
  if (!form.deadline) errors.deadline = "Pick when the task is due.";
  if (!(Number(form.originalEstimate) >= 1)) errors.estimate = "Add how long the whole task will take.";
  return errors;
}

/** Reads a number field, treating a cleared box as zero. */
function wholeNumber(value: string): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function TaskFormDialog({ open, onOpenChange, task, onSaved }: TaskFormDialogProps) {
  const timeZone = useAccountTimezone();
  const [form, setForm] = useState(() => emptyForm(timeZone));
  const [initialForm, setInitialForm] = useState(form);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  /**
   * SPEC §15.4 / §15.6: the student's own history may suggest a very different
   * duration. The explanation is always shown; the acknowledgment dialog only
   * blocks the first time a category swings beyond 2× or below 0.5×.
   */
  /** Whether the current category/original pair may adopt a preview default. */
  const [applyPreviewDefault, setApplyPreviewDefault] = useState(true);
  const [ackOpen, setAckOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = Boolean(task);
  const estimateFrozen = task?.estimateFrozen === true;

  // Reset the fields whenever the dialog opens, or the task being edited
  // changes while it is open. Adjusting during render rather than in an effect
  // avoids showing the previous task's values for one frame.
  const [session, setSession] = useState<{ open: boolean; task?: AcademicTask | null }>({
    open: false,
  });
  if (open && (session.open !== open || session.task !== task)) {
    setSession({ open, task });
    setError(null);
    setFieldErrors({});
    setAckOpen(false);
    setDiscardOpen(false);
    setApplyPreviewDefault(!task);
    const initial = task
        ? {
            title: task.title,
            category: task.category,
            priority: task.priority,
            deadline: isoToLocalInput(task.deadline, timeZone),
            originalEstimate: task.originalEstimate,
            plannedSource: task.plannedSource,
            course: task.course ?? "",
            notes: task.notes ?? "",
          }
        : emptyForm(timeZone);
    setForm(initial);
    setInitialForm(initial);
  } else if (!open && session.open) {
    setSession({ open: false });
  }

  const previewMinutes = Number(form.originalEstimate);
  const previewKey =
    open && !estimateFrozen && previewMinutes > 0
      ? adaptiveEstimateKey(form.category, previewMinutes)
      : null;
  const previewFetcher = useCallback(() => {
    return scheduling.getAdaptiveEstimate(form.category, previewMinutes);
  }, [form.category, previewMinutes]);
  const {
    data: preview,
    error: previewError,
    mutate: mutatePreview,
  } = useSWR<AdaptiveEstimate | null>(
    previewKey,
    previewFetcher,
    {
      dedupingInterval: 0,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      onSuccess: (next) => {
        if (!open || estimateFrozen) return;
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
        // Preview defaults are not student edits. Keep the new-task baseline
        // in sync only when the preview describes its original inputs.
        if (!task && applyPreviewDefault) {
          setInitialForm((initial) =>
            initial.category === form.category &&
            initial.originalEstimate === previewMinutes
              ? { ...initial, ...resolvePreviewSelection(initial.originalEstimate, next, initial.plannedSource, true) }
              : initial,
          );
        }
      },
    },
  );
  const estimate = previewError ? null : preview ?? null;
  const isDirty = (Object.keys(initialForm) as (keyof TaskFormState)[]).some(
    (key) => form[key] !== initialForm[key],
  );

  function requestClose() {
    if (isSaving || ackOpen || discardOpen) return false;
    if (isDirty) {
      setDiscardOpen(true);
      return false;
    }
    onOpenChange(false);
    return true;
  }

  function chooseEstimate(which: "original" | "adaptive") {
    const action = resolveEstimateChoiceAction(form.originalEstimate, estimate, which);
    if (action.type === "acknowledge") {
      setAckOpen(true);
      return;
    }

    setApplyPreviewDefault(false);
    setForm((current) => ({ ...current, ...action.selection }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const problems = validate(form);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;

    // Ask before using a first-time large adjustment (SPEC §15.4).
    const adaptivePreviewMatchesForm =
      estimate?.category === form.category &&
      estimate.originalEstimate === Number(form.originalEstimate);
    if (!estimateFrozen && form.plannedSource === "Adaptive" && !adaptivePreviewMatchesForm) {
      setError("Adaptive planning is still being checked. Try again in a moment.");
      return;
    }

    if (!estimateFrozen && form.plannedSource === "Adaptive" && estimate?.needsAcknowledgment) {
      setAckOpen(true);
      return;
    }

    setIsSaving(true);

    const payload: TaskFormData = {
      title: form.title,
      category: form.category,
      priority: form.priority,
      deadline: localInputToIso(form.deadline, timeZone),
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
      if (cause instanceof ApiError && cause.status === 409 && cause.code === "adaptive_estimate_conflict") {
        setError(cause.detail);
        setAckOpen(false);
        setApplyPreviewDefault(false);
        setForm((current) => ({ ...current, plannedSource: "Original" }));
        void mutatePreview(undefined, { revalidate: true });
      } else if (cause instanceof ApiError && cause.status === 409) {
        setError(cause.detail);
      } else {
        setError(describeError(cause));
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) onOpenChange(true);
        else if (!requestClose()) details?.cancel?.();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit task" : "Add task"}</DialogTitle>
          <DialogDescription>
            Tell StudyFlow what is due and roughly how long it takes, and it will find study time for it. Times
            use your time zone ({timeZone}).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="min-w-0 space-y-4">
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
              aria-invalid={fieldErrors.title ? true : undefined}
              aria-describedby={fieldErrors.title ? "task-title-error" : undefined}
            />
            <FieldError id="task-title-error" message={fieldErrors.title} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-category" className="text-xs font-medium">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => {
                  if (!v) return;
                  setApplyPreviewDefault(true);
                  setForm({ ...form, category: v as Category, plannedSource: estimateFrozen ? form.plannedSource : "Original" });
                }}
              >
                <SelectTrigger id="task-category" aria-label="Category" className="w-full">
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
              <Label htmlFor="task-priority" className="text-xs font-medium">Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => v && setForm({ ...form, priority: v as Priority })}
              >
                <SelectTrigger id="task-priority" aria-label="Priority" className="w-full">
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
                min={nowLocalInput(timeZone)}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                disabled={isSaving}
                required
                aria-invalid={fieldErrors.deadline ? true : undefined}
                aria-describedby={fieldErrors.deadline ? "task-deadline-error" : undefined}
              />
              <FieldError id="task-deadline-error" message={fieldErrors.deadline} />
            </div>

            <fieldset className="min-w-0 space-y-1.5">
              <legend className="mb-1.5 text-xs font-medium">How long it takes</legend>
              <div className="flex items-center gap-2">
                <Input
                  id="task-estimate-hours"
                  aria-label="Estimate hours"
                  type="number"
                  inputMode="numeric"
                  disabled={isSaving || estimateFrozen}
                  min={0}
                  value={Math.floor(form.originalEstimate / 60)}
                  onChange={(e) => {
                    setApplyPreviewDefault(true);
                    setForm({
                      ...form,
                      originalEstimate: wholeNumber(e.target.value) * 60 + (form.originalEstimate % 60),
                      plannedSource: "Original",
                    });
                  }}
                  aria-invalid={fieldErrors.estimate ? true : undefined}
                  aria-describedby={fieldErrors.estimate ? "task-estimate-error" : undefined}
                />
                <span aria-hidden className="text-xs text-muted-foreground">h</span>
                <Input
                  id="task-estimate"
                  aria-label="Estimate minutes"
                  type="number"
                  inputMode="numeric"
                  disabled={isSaving || estimateFrozen}
                  min={0}
                  max={59}
                  step={5}
                  value={form.originalEstimate % 60}
                  onChange={(e) => {
                    setApplyPreviewDefault(true);
                    setForm({
                      ...form,
                      originalEstimate: Math.floor(form.originalEstimate / 60) * 60 + wholeNumber(e.target.value),
                      plannedSource: "Original",
                    });
                  }}
                  aria-invalid={fieldErrors.estimate ? true : undefined}
                  aria-describedby={fieldErrors.estimate ? "task-estimate-error" : undefined}
                />
                <span aria-hidden className="text-xs text-muted-foreground">m</span>
              </div>
              <FieldError id="task-estimate-error" message={fieldErrors.estimate} />
              {estimateFrozen ? (
                <p className="text-[11px] text-muted-foreground">
                  Frozen — this task has already been scheduled or started.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  The whole task, not one sitting.
                </p>
              )}
            </fieldset>
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

          <div className="min-w-0 space-y-1.5">
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

          {estimateFrozen && task?.adaptiveEstimate !== undefined && (
            <PersistedEstimateNote
              originalEstimate={task.originalEstimate}
              adaptiveEstimate={task.adaptiveEstimate}
              plannedDuration={task.plannedDuration}
              plannedSource={task.plannedSource}
            />
          )}
          {!estimateFrozen && estimate && (
            <AdaptiveEstimateNote
              estimate={{
                ...estimate,
                plannedDuration:
                  form.plannedSource === "Adaptive"
                    ? estimate.adaptiveEstimate
                    : Number(form.originalEstimate),
                plannedSource: form.plannedSource,
              }}
              onChoose={chooseEstimate}
            />
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={requestClose}
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

      <ConfirmDialog
        open={open && discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard changes?"
        description="Your unsaved changes will be lost."
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        destructive
        focusCancel
        onConfirm={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
      />

      <LargeAdjustmentDialog
        estimate={estimate}
        open={ackOpen}
        onOpenChange={setAckOpen}
        onDecided={(which) => {
          setApplyPreviewDefault(false);
          void mutatePreview(
            (current) => (current ? { ...current, needsAcknowledgment: false } : current),
            { revalidate: false },
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
