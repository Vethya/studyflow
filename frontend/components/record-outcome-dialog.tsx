"use client";

import * as React from "react";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
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
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDuration } from "@/lib/constants";
import { formatClock } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { scheduling } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { LARGE_ENTRY_FACTOR, type SessionOutcome, type StudySession } from "@/types/session";
import type { OutcomeResult } from "@/lib/api";

const OPTIONS: {
  value: SessionOutcome;
  label: string;
  hint: string;
  icon: React.ElementType;
}[] = [
  { value: "Completed", label: "Finished it", hint: "The work for this session is done", icon: CheckCircle2 },
  { value: "Delayed", label: "Partly done", hint: "I worked, but there is more left", icon: Clock },
  { value: "Missed", label: "Didn’t study", hint: "This session didn’t happen", icon: XCircle },
];

/**
 * Records what actually happened in a past session (SPEC §12).
 *
 * The three outcomes collect different things:
 *   Completed — minutes worked; nothing remains.
 *   Delayed   — minutes worked *and* minutes still left. The remaining figure
 *               is pre-filled with `planned − worked` but stays editable,
 *               because time spent does not prove equivalent work done
 *               (SPEC §12.3).
 *   Missed    — nothing worked; the full planned work stands.
 *
 * Saving Delayed or Missed produces a proposed Schedule Revision, which the
 * caller is handed so it can show the preview (SPEC §14.1).
 */
export function RecordOutcomeDialog({
  session,
  open,
  onOpenChange,
  onRecorded,
}: {
  session: StudySession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (result: OutcomeResult) => void;
}) {
  const [outcome, setOutcome] = React.useState<SessionOutcome>("Completed");
  const [worked, setWorked] = React.useState("");
  const [remaining, setRemaining] = React.useState("");
  const [remainingTouched, setRemainingTouched] = React.useState(false);
  const [isSaving, setSaving] = React.useState(false);
  const [confirmLarge, setConfirmLarge] = React.useState(false);

  const planned = session?.plannedDuration ?? 0;

  /*
   * Reset to a sensible default when the dialog opens on a different session.
   *
   * Adjusted during render against a remembered id rather than in an effect:
   * an effect would render the previous session's figures for one frame and
   * then immediately re-render, which is the cascading update React warns
   * about. This is the sanctioned "adjust state when a prop changes" pattern.
   */
  const [lastSessionId, setLastSessionId] = React.useState<string | null>(null);
  if (open && session && session.id !== lastSessionId) {
    setLastSessionId(session.id);
    setOutcome("Completed");
    setWorked(String(session.plannedDuration));
    setRemaining("");
    setRemainingTouched(false);
  }

  const workedNumber = Number(worked);
  const hasWorked = worked.trim() !== "" && Number.isFinite(workedNumber);

  // SPEC §12.3's default, recomputed until the student edits it themselves.
  const defaultRemaining = Math.max(0, planned - (hasWorked ? workedNumber : 0));
  const remainingValue = remainingTouched ? remaining : String(defaultRemaining || "");
  const remainingNumber = Number(remainingValue);

  const workedInvalid = outcome !== "Missed" && (!hasWorked || workedNumber <= 0);
  const remainingInvalid =
    outcome === "Delayed" && (!Number.isFinite(remainingNumber) || remainingNumber <= 0);
  const canSave = !workedInvalid && !remainingInvalid && !isSaving;

  /** An entry far above what was planned is more often a typo than a marathon. */
  const isLargeEntry =
    outcome !== "Missed" && hasWorked && workedNumber > planned * LARGE_ENTRY_FACTOR;

  async function save() {
    if (!session) return;
    setSaving(true);
    try {
      const result = await scheduling.recordOutcome(session.id, {
        outcome,
        actualMinutes: outcome === "Missed" ? 0 : workedNumber,
        revisedRemainingMinutes: outcome === "Delayed" ? remainingNumber : undefined,
      });
      toast.success(
        outcome === "Completed"
          ? "Session recorded"
          : "Recorded — StudyFlow has a new plan for you to review",
      );
      onRecorded(result);
      onOpenChange(false);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (isLargeEntry) {
      setConfirmLarge(true);
      return;
    }
    void save();
  }

  if (!session) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>How did it go?</DialogTitle>
            <DialogDescription>
              {session.taskTitle} · {formatClock(session.startTime)}–
              {formatClock(session.endTime)} · {formatDuration(planned)} planned
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="eyebrow mb-2">What happened</legend>
              <div className="grid gap-2">
                {OPTIONS.map((option) => {
                  const selected = outcome === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setOutcome(option.value)}
                      aria-pressed={selected}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        selected
                          ? "border-foreground bg-muted"
                          : "border-border hover:bg-muted/50",
                      )}
                    >
                      <option.icon
                        className={cn(
                          "size-4 shrink-0",
                          selected ? "text-foreground" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {outcome !== "Missed" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="worked" className="eyebrow">
                    Minutes you worked
                  </Label>
                  <Input
                    id="worked"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1440}
                    value={worked}
                    onChange={(event) => setWorked(event.target.value)}
                    aria-invalid={workedInvalid || undefined}
                  />
                  {workedInvalid && (
                    <p className="text-xs text-deficit">Enter more than 0 minutes.</p>
                  )}
                </div>

                {outcome === "Delayed" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="remaining" className="eyebrow">
                      Minutes still left
                    </Label>
                    <Input
                      id="remaining"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={10_000}
                      value={remainingValue}
                      onChange={(event) => {
                        setRemainingTouched(true);
                        setRemaining(event.target.value);
                      }}
                      aria-invalid={remainingInvalid || undefined}
                    />
                    <p className="text-xs text-muted-foreground">
                      {remainingTouched
                        ? "Your estimate of what is left."
                        : "Our guess — change it if you know better."}
                    </p>
                    {remainingInvalid && (
                      <p className="text-xs text-deficit">Enter more than 0 minutes.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {outcome === "Missed" && (
              <Callout tone="info" title="Nothing is lost">
                All {formatDuration(planned)} of this session goes back into the plan, and
                StudyFlow will look for a new slot.
              </Callout>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {isSaving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SPEC §12.2: prompt on an unusually large entry, but always allow it. */}
      <ConfirmDialog
        open={confirmLarge}
        onOpenChange={setConfirmLarge}
        title="That is a lot longer than planned"
        description={`You planned ${formatDuration(planned)} but entered ${formatDuration(
          Math.round(workedNumber || 0),
        )}. Is that right?`}
        confirmLabel="Yes, save it"
        cancelLabel="Let me check"
        onConfirm={save}
      />
    </>
  );
}
