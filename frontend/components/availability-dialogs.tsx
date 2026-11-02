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
import { AlertCircle, Loader2 } from "@/components/icons";
import { DAY_NAMES } from "@/lib/constants";
import { isoToLocalInput, localInputToIso } from "@/lib/datetime";
import type { WindowDraft } from "@/lib/api";
import type { UnavailablePeriod } from "@/types/availability";
import { useAccountTimezone } from "@/hooks/use-account-timezone";

interface AddWindowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persists the window; the parent owns the replace-all PUT. */
  onSubmit: (draft: WindowDraft) => Promise<void>;
  /** Weekday (0 = Sunday) the form starts on. Defaults to Monday. */
  defaultDay?: number;
  /** Pass a window to edit it; omit to add a new one. */
  window?: WindowDraft | null;
  /** The student's other weekly hours, used to suggest a free slot and catch duplicates. */
  existing?: WindowDraft[];
}

const SUGGESTED_TIMES: Array<[string, string]> = [
  ["18:00", "21:00"],
  ["09:00", "12:00"],
  ["14:00", "17:00"],
  ["06:00", "08:00"],
  ["21:00", "23:00"],
];

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** A window as same-day minute ranges; one that ends before it starts runs past midnight. */
function rangesOf(window: Pick<WindowDraft, "startTime" | "endTime">): Array<[number, number]> {
  const start = minutesOf(window.startTime);
  const end = minutesOf(window.endTime);
  return end > start ? [[start, end]] : [[start, 24 * 60], [0, end]];
}

function overlaps(a: WindowDraft, b: WindowDraft): boolean {
  return rangesOf(a).some(([as, ae]) => rangesOf(b).some(([bs, be]) => as < be && bs < ae));
}

/** First common study slot that does not collide with the day's existing hours. */
export function suggestWindowTimes(dayOfWeek: number, existing: WindowDraft[]): { startTime: string; endTime: string } {
  const sameDay = existing.filter((w) => w.dayOfWeek === dayOfWeek);
  const free = SUGGESTED_TIMES.find(([startTime, endTime]) =>
    sameDay.every((w) => !overlaps({ dayOfWeek, startTime, endTime }, w)),
  );
  const [startTime, endTime] = free ?? SUGGESTED_TIMES[0];
  return { startTime, endTime };
}

/** An existing window that already contains the whole draft, so saving would change nothing. */
export function coveringWindow(draft: WindowDraft, existing: WindowDraft[]): WindowDraft | undefined {
  const [inner, ...rest] = rangesOf(draft);
  if (rest.length > 0) return undefined;
  return existing.find((w) => {
    if (w.dayOfWeek !== draft.dayOfWeek) return false;
    return rangesOf(w).some(([s, e]) => s <= inner[0] && inner[1] <= e);
  });
}

/**
 * Collects one recurring weekly window, new or edited. The backend replaces
 * the whole set on every save and merges overlaps itself, so this suggests a
 * free slot, refuses a window that is already fully covered, and otherwise
 * only checks that the times differ.
 */
export function AddWindowDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultDay = 1,
  window: editing = null,
  existing = [],
}: AddWindowDialogProps) {
  const [dayOfWeek, setDayOfWeek] = useState(String(defaultDay));
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("21:00");
  const [initial, setInitial] = useState({ dayOfWeek: String(defaultDay), startTime: "18:00", endTime: "21:00" });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const others = editing
    ? existing.filter(
        (w) =>
          !(w.dayOfWeek === editing.dayOfWeek && w.startTime === editing.startTime && w.endTime === editing.endTime),
      )
    : existing;

  function seed(day: number) {
    const times = editing ?? suggestWindowTimes(day, others);
    const next = { dayOfWeek: String(editing?.dayOfWeek ?? day), startTime: times.startTime, endTime: times.endTime };
    setDayOfWeek(next.dayOfWeek);
    setStartTime(next.startTime);
    setEndTime(next.endTime);
    setInitial(next);
  }

  // Start each opening on the requested day with a slot that is actually free.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setDiscardOpen(false);
      seed(defaultDay);
    }
  }

  const timesUntouched = startTime === initial.startTime && endTime === initial.endTime;
  const isDirty = dayOfWeek !== initial.dayOfWeek || !timesUntouched;

  function changeDay(next: string) {
    setDayOfWeek(next);
    // Follow the new day with a free slot unless the student chose the times.
    if (!editing && timesUntouched) {
      const times = suggestWindowTimes(Number(next), others);
      setStartTime(times.startTime);
      setEndTime(times.endTime);
      setInitial({ dayOfWeek: initial.dayOfWeek, ...times });
    }
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
    const draft = { dayOfWeek: Number(dayOfWeek), startTime, endTime };
    const cover = coveringWindow(draft, others);
    if (cover) {
      setError(
        `${DAY_NAMES[cover.dayOfWeek]} already has study hours from ${cover.startTime} to ${cover.endTime}, which cover this time.`,
      );
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSubmit(draft);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save these study hours.");
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
          <DialogTitle>{editing ? "Edit study hours" : "Add study hours"}</DialogTitle>
          <DialogDescription>
            A time you can study every week. An end time earlier than the start runs past midnight.
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
            <Label htmlFor="window-day" className="text-xs font-medium">Day</Label>
            <Select value={dayOfWeek} onValueChange={(v) => v && changeDay(v as string)}>
              <SelectTrigger id="window-day" aria-label="Day" className="w-full">
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
              {editing ? "Save changes" : "Add study hours"}
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
  const timeZone = useAccountTimezone();
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
    const initStartsAt = period ? isoToLocalInput(period.startDate, timeZone) : "";
    const initEndsAt = period ? isoToLocalInput(period.endDate, timeZone) : "";
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
    if (new Date(localInputToIso(endsAt, timeZone)) <= new Date(localInputToIso(startsAt, timeZone))) {
      setError("The end must come after the start.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      // Converted to an absolute instant: the API rejects offset-less values.
      await onSubmit({
        startsAt: localInputToIso(startsAt, timeZone),
        endsAt: localInputToIso(endsAt, timeZone),
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
