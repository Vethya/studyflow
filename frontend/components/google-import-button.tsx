"use client";

import { useCallback, useState } from "react";
import { CalendarDays, GraduationCap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { googleImport } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import { SWR_KEYS } from "@/lib/swr-keys";

const HORIZONS = [
  { days: 14, label: "Next 2 weeks" },
  { days: 28, label: "Next 4 weeks" },
  { days: 56, label: "Next 8 weeks" },
  { days: 90, label: "Next 3 months" },
] as const;

const COPY = {
  google_calendar: {
    name: "Google Calendar",
    button: "Import from Google Calendar",
    title: "Import busy time from Google Calendar",
    description:
      "StudyFlow will read the events in your primary calendar once, so you can choose which ones to block out as time you cannot study.",
    reads: "Read-only access to your calendar events",
    icon: CalendarDays,
  },
  google_classroom: {
    name: "Google Classroom",
    button: "Import from Google Classroom",
    title: "Import coursework from Google Classroom",
    description:
      "StudyFlow will read your active classes once and list the coursework you have not turned in yet, so you can choose which to add as tasks.",
    reads: "Read-only access to your classes and your own coursework",
    icon: GraduationCap,
  },
} as const;

/** Past this many days without checking, the reminder appears. */
const REMIND_AFTER_DAYS = 3;

function useImportStatus() {
  const load = useCallback((signal: AbortSignal) => googleImport.getStatus(signal), []);
  return useApi(SWR_KEYS.googleImportStatus, load);
}

function daysSince(value: string | null, now: number): number | null {
  if (value === null) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now - then) / 86_400_000);
}

/** "today", "yesterday", "6 days ago" — the only phrasing for a past check. */
export function describeLastCheck(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * Explains exactly what Google will be asked for before the student leaves
 * StudyFlow, then hands the browser to Google's consent screen.
 */
function ImportDialog({
  source,
  open,
  onOpenChange,
}: {
  source: googleImport.GoogleImportSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [horizon, setHorizon] = useState("28");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[source];

  async function start() {
    setIsStarting(true);
    setError(null);
    try {
      const url =
        source === "google_calendar"
          ? await googleImport.startCalendarImport(Number(horizon))
          : await googleImport.startClassroomImport();
      window.location.assign(url);
    } catch (cause) {
      setError(describeError(cause));
      setIsStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isStarting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {error && <Callout tone="danger">{error}</Callout>}

          {source === "google_calendar" && (
            <div className="space-y-1.5">
              <Label htmlFor="google-import-horizon" className="eyebrow">
                Events from
              </Label>
              <Select value={horizon} onValueChange={(value) => value && setHorizon(value)}>
                <SelectTrigger id="google-import-horizon" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      HORIZONS.find((option) => String(option.days) === value)?.label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HORIZONS.map((option) => (
                    <SelectItem key={option.days} value={String(option.days)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <ul className="space-y-1.5 text-muted-foreground">
            <li>• {copy.reads}. Nothing in Google is changed.</li>
            <li>• StudyFlow keeps no access afterwards and stores no Google password or token.</li>
            <li>• Nothing is added until you review the list and confirm.</li>
          </ul>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isStarting}>
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={isStarting} aria-busy={isStarting}>
            {isStarting && <Loader2 className="animate-spin" />}
            Continue to Google
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hidden when the server has no Google import configured. */
export function GoogleImportButton({
  source,
  variant = "outline",
}: {
  source: googleImport.GoogleImportSource;
  variant?: "outline" | "default" | "ghost";
}) {
  const status = useImportStatus();
  const [open, setOpen] = useState(false);

  if (!status.data?.configured) return null;
  const copy = COPY[source];
  const Icon = copy.icon;

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Icon />
        {copy.button}
      </Button>
      <ImportDialog source={source} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * A quiet line for students who have imported before: StudyFlow cannot watch
 * Google in the background, so it says how long it has been instead of
 * pretending to know whether anything is new.
 */
export function GoogleImportReminder({
  source,
}: {
  source: googleImport.GoogleImportSource;
}) {
  const status = useImportStatus();
  const now = useNow();
  const [open, setOpen] = useState(false);

  const checkedAt =
    source === "google_calendar"
      ? (status.data?.calendarCheckedAt ?? null)
      : (status.data?.classroomCheckedAt ?? null);
  const days = daysSince(checkedAt, now.getTime());

  if (!status.data?.configured || days === null || days < REMIND_AFTER_DAYS) return null;
  const copy = COPY[source];

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>
        Last checked {copy.name} {describeLastCheck(days)}.
      </span>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={() => setOpen(true)}
      >
        Check again
      </Button>
      <ImportDialog source={source} open={open} onOpenChange={setOpen} />
    </p>
  );
}
