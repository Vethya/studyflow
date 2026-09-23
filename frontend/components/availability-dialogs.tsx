"use client";

import { useState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2 } from "lucide-react";
import { DAY_NAMES } from "@/lib/constants";
import { isoToLocalInput } from "@/lib/datetime";
import type { WindowDraft } from "@/lib/api";
import type { UnavailablePeriod } from "@/types/availability";

interface AddWindowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persists the window; the parent owns the replace-all PUT. */
  onSubmit: (draft: WindowDraft) => Promise<void>;
}

/**
 * Collects one recurring weekly window. The backend replaces the whole set on
 * every save and merges overlaps itself, so this only validates that the times
 * are present and not identical.
 */
export function AddWindowDialog({ open, onOpenChange, onSubmit }: AddWindowDialogProps) {
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("21:00");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // Clear any stale error each time the dialog is reopened.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setDiscardOpen(false);
    }
  }

  const isDirty = dayOfWeek !== "1" || startTime !== "18:00" || endTime !== "21:00";

  function resetForm() {
    setDayOfWeek("1");
    setStartTime("18:00");
    setEndTime("21:00");
    setError(null);
  }

  function requestClose() {
    if (isSaving || discardOpen) return false;
    if (isDirty) {
      setDiscardOpen(true);
      return false;
    }
    onOpenChange(false);
    return true;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (startTime === endTime) {
      setError("Start and end times must differ.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSubmit({ dayOfWeek: Number(dayOfWeek), startTime, endTime });
      resetForm();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the window.");
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add availability window</DialogTitle>
          <DialogDescription>
            A recurring weekly block. An end time earlier than the start crosses midnight.
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
            <Label className="text-xs font-medium">Day</Label>
            <Select value={dayOfWeek} onValueChange={(v) => v && setDayOfWeek(v as string)}>
              <SelectTrigger className="w-full">
                {/* Base UI renders the raw value unless given a render
                    function, which would show the index instead of the day. */}
                <SelectValue>{(value) => DAY_NAMES[Number(value)]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>{day}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="window-start" className="text-xs font-medium">Start</Label>
              <Input
                id="window-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={isSaving}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="window-end" className="text-xs font-medium">End</Label>
              <Input
                id="window-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={isSaving}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={requestClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add window
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
          resetForm();
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

interface ExceptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create; pass a period to edit it in place. */
  period?: UnavailablePeriod | null;
  onSubmit: (draft: { startsAt: string; endsAt: string; reason?: string }) => Promise<void>;
}

/** One-off unavailable period, e.g. a trip or an exam day. */
export function ExceptionDialog({
  open,
  onOpenChange,
  period,
  onSubmit,
}: ExceptionDialogProps) {
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [initialForm, setInitialForm] = useState({ startsAt: "", endsAt: "", reason: "" });

  const isEditing = Boolean(period);

  // Seed from the period being edited, or start blank, each time the dialog
  // opens or the target changes while it is open.
  const [session, setSession] = useState<{ open: boolean; period?: UnavailablePeriod | null }>({
    open: false,
  });
  if (open && (session.open !== open || session.period !== period)) {
    setSession({ open, period });
    setError(null);
    setDiscardOpen(false);
    const initStartsAt = period ? isoToLocalInput(period.startDate) : "";
    const initEndsAt = period ? isoToLocalInput(period.endDate) : "";
    const initReason = period?.reason ?? "";
    setStartsAt(initStartsAt);
    setEndsAt(initEndsAt);
    setReason(initReason);
    setInitialForm({ startsAt: initStartsAt, endsAt: initEndsAt, reason: initReason });
  } else if (!open && session.open) {
    setSession({ open: false });
  }

  const isDirty =
    startsAt !== initialForm.startsAt ||
    endsAt !== initialForm.endsAt ||
    reason !== initialForm.reason;

  function requestClose() {
    if (isSaving || discardOpen) return false;
    if (isDirty) {
      setDiscardOpen(true);
      return false;
    }
    onOpenChange(false);
    return true;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError("The end must come after the start.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      // Converted to an absolute instant: the API rejects offset-less values.
      await onSubmit({
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        reason: reason || undefined,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the exception.");
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit exception" : "Add exception"}</DialogTitle>
          <DialogDescription>
            Block out a one-off period. Time inside it stops counting towards your
            weekly study capacity.
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
            <Label htmlFor="exception-start" className="text-xs font-medium">Starts</Label>
            <Input
              id="exception-start"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={isSaving}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exception-end" className="text-xs font-medium">Ends</Label>
            <Input
              id="exception-end"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={isSaving}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exception-reason" className="text-xs font-medium">Reason (optional)</Label>
            <Input
              id="exception-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Family trip"
              disabled={isSaving}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={requestClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save changes" : "Add exception"}
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
    </Dialog>
  );
}
