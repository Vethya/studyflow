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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2 } from "lucide-react";
import { DAY_NAMES } from "@/lib/constants";
import type { WindowDraft } from "@/lib/api";

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

  // Clear any stale error each time the dialog is reopened.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
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
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the window.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                <SelectValue />
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add window
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ExceptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: { startsAt: string; endsAt: string; reason?: string }) => Promise<void>;
}

/** One-off unavailable period, e.g. a trip or an exam day. */
export function ExceptionDialog({ open, onOpenChange, onSubmit }: ExceptionDialogProps) {
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Start from a blank form each time the dialog is reopened.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setStartsAt("");
      setEndsAt("");
      setReason("");
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add exception</DialogTitle>
          <DialogDescription>
            Block out a one-off period. Study sessions already planned inside it are cancelled.
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add exception
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
