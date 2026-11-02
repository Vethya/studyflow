"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useMemo, useState } from "react";
import { CalendarDays, Clock, ExternalLink, GraduationCap, Loader2 } from "@/components/icons";
import { toast } from "sonner";
import { EmptyState, PageHeader, PageShell } from "@/components/page-kit";
import { DateLeaf, DueChip, StepFlow } from "@/components/study-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, googleImport } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "@/types/task";
import { formatClock, formatDate, formatDateTime as formatZonedDateTime } from "@/lib/datetime";
import { formatDuration } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAccountTimezone } from "@/hooks/use-account-timezone";

type CalendarItem = googleImport.CalendarImportItem;
type ClassroomItem = googleImport.ClassroomImportItem;

const DEFAULT_ESTIMATE_MINUTES = 60;
const MAX_ESTIMATE_MINUTES = 7 * 24 * 60;
const ESTIMATE_PRESETS = [30, 60, 120, 240];
const IMPORT_STEPS = ["Connect Google", "Choose what to add", "Done"];

function formatDateTime(value: string, timeZone: string, allDay = false): string {
  return allDay
    ? formatDate(value, timeZone, { weekday: "short", day: "numeric", month: "short" })
    : formatZonedDateTime(value, timeZone, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
}

function formatRange(item: CalendarItem, timeZone: string): string {
  if (item.allDay) {
    // All-day events end at midnight after their last day.
    const lastDay = new Date(new Date(item.endsAt).getTime() - 1).toISOString();
    const first = formatDateTime(item.startsAt, timeZone, true);
    const last = formatDateTime(lastDay, timeZone, true);
    return first === last ? `${first}, all day` : `${first} – ${last}, all day`;
  }
  const end = formatClock(item.endsAt, timeZone);
  return `${formatDateTime(item.startsAt, timeZone)} – ${end}`;
}

export default function GoogleImportReviewPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = use(params);
  const load = useCallback(
    (signal: AbortSignal) => googleImport.getImport(importId, signal),
    [importId],
  );
  const preview = useApi(["studyflow/integrations/google/import", importId], load);

  if (preview.isLoading) {
    return (
      <PageShell width="narrow">
        <StepFlow steps={IMPORT_STEPS} current={1} label="Import steps" />
        <div aria-busy className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading your import…
          </p>
          <div className="divide-y rounded-2xl border bg-card">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-4 rounded-sm" />
                <Skeleton className="h-11 w-11" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </PageShell>
    );
  }

  if (preview.error || !preview.data) {
    const expired = preview.error instanceof ApiError && preview.error.isNotFound;
    return (
      <PageShell width="narrow">
        <PageHeader eyebrow="Google" title="Google import" />
        <Callout
          tone="warning"
          title={expired ? "This import has expired or was already used" : "Could not load this import"}
          actions={
            <>
              <Button size="sm" nativeButton={false} render={<Link href="/availability" />}>
                Availability
              </Button>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/tasks" />}>
                Tasks
              </Button>
            </>
          }
        >
          {expired
            ? "Imports stay open for 30 minutes and can be confirmed once. Start a new import to see your latest Google data."
            : describeError(preview.error)}
        </Callout>
      </PageShell>
    );
  }

  return preview.data.source === "google_calendar" ? (
    <CalendarReview importId={importId} items={preview.data.items} expiresAt={preview.data.expiresAt} />
  ) : (
    <ClassroomReview importId={importId} items={preview.data.items} expiresAt={preview.data.expiresAt} />
  );
}

function useDiscard(importId: string, destination: string) {
  const router = useRouter();
  const [isDiscarding, setIsDiscarding] = useState(false);
  async function discard() {
    setIsDiscarding(true);
    try {
      await googleImport.discardImport(importId);
    } catch {
      // Already expired or used; nothing left to discard.
    }
    router.push(destination);
  }
  return { discard, isDiscarding };
}

/** The list is short-lived, so say exactly how long it lasts. */
function ExpiryNote({ expiresAt }: { expiresAt: string }) {
  const timeZone = useAccountTimezone();
  const now = useNow(30_000);
  const time = formatClock(expiresAt, timeZone);
  const minutesLeft = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 60_000);
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <Clock className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        This list is kept only until {time}
        {minutesLeft > 0 && minutesLeft <= 30 && (
          <span className="tabular-nums"> ({minutesLeft} min left)</span>
        )}
        . Nothing is added until you confirm.
      </span>
    </p>
  );
}

/** The confirm bar stays in reach while a long list scrolls past. */
function ActionBar({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-t bg-background/90 px-1 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-sm">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {summary}
      </p>
      <div className="ms-auto flex flex-wrap justify-end gap-2">{children}</div>
    </div>
  );
}

// ─── Google Calendar ────────────────────────────────────────────────────────

function CalendarReview({
  importId,
  items,
  expiresAt,
}: {
  importId: string;
  items: CalendarItem[];
  expiresAt: string;
}) {
  const timeZone = useAccountTimezone();
  const selectable = useMemo(() => items.filter((item) => item.status !== "unchanged"), [items]);
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        selectable
          // All-day events are often holidays or reminders, so the student opts in.
          .filter((item) => item.status === "changed" || !item.allDay)
          .map((item) => item.id),
      ),
  );
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<googleImport.CalendarImportResult | null>(null);
  const { discard, isDiscarding } = useDiscard(importId, "/availability");
  const hasAllDay = selectable.some((item) => item.allDay);

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function confirm() {
    setIsImporting(true);
    setError(null);
    try {
      const outcome = await googleImport.importCalendarItems(importId, [...selected]);
      setResult(outcome);
      toast.success("Google Calendar events imported");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setIsImporting(false);
    }
  }

  if (result) {
    const invalidated = result.invalidatedFutureSessionIds.length;
    return (
      <PageShell width="narrow">
        <StepFlow steps={IMPORT_STEPS} current={IMPORT_STEPS.length} label="Import steps" />
        <PageHeader icon={CalendarDays} eyebrow="Google Calendar" title="Google Calendar import finished" />
        <Callout
          tone="success"
          title={`${result.created} added, ${result.updated} updated`}
          actions={
            <Button size="sm" nativeButton={false} render={<Link href="/availability" />}>
              Go to Availability
            </Button>
          }
        >
          {result.unchanged > 0 &&
            `${result.unchanged} ${result.unchanged === 1 ? "was" : "were"} already up to date. `}
          {result.skippedPast > 0 &&
            `${result.skippedPast} had already ended and ${
              result.skippedPast === 1 ? "was" : "were"
            } skipped. `}
          The imported events are now blocked time, so StudyFlow will not plan study sessions
          during them.
        </Callout>
        {invalidated > 0 && (
          <Callout
            tone="warning"
            title={`${invalidated} planned ${invalidated === 1 ? "session no longer fits" : "sessions no longer fit"}`}
            actions={
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/calendar" />}>
                Re-plan from Calendar
              </Button>
            }
          >
            That work has been put back on your list so it can be planned again.
          </Callout>
        )}
      </PageShell>
    );
  }

  return (
    <PageShell width="narrow">
      <StepFlow steps={IMPORT_STEPS} current={1} label="Import steps" />
      <PageHeader
        icon={CalendarDays}
        eyebrow="Google Calendar"
        title="Review your Google Calendar events"
        description="Tick the events you cannot study during. Each one becomes blocked time on your Availability page."
      />
      <ExpiryNote expiresAt={expiresAt} />
      {error && <Callout tone="danger">{error}</Callout>}

      {items.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No busy events found">
          Your primary Google Calendar has no upcoming events that mark you as busy in this range.
        </EmptyState>
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="sr-only">Google Calendar events</legend>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {selected.size} of {selectable.length} selected
            </span>
            <span className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set(selectable.map((item) => item.id)))}
              >
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </span>
          </div>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((item) => {
              const disabled = item.status === "unchanged";
              const checked = selected.has(item.id);
              const checkboxId = `calendar-${item.id}`;
              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors duration-150 compact:py-2",
                    checked && "bg-primary/[0.04]",
                  )}
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(next) => toggle(item.id, next === true)}
                  />
                  <DateLeaf date={item.startsAt} />
                  <Label
                    htmlFor={checkboxId}
                    className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 font-normal"
                  >
                    <span className="block w-full truncate font-medium">{item.title}</span>
                    <span className="block text-xs text-muted-foreground">{formatRange(item, timeZone)}</span>
                  </Label>
                  {item.status === "unchanged" && <Badge variant="secondary">Already imported</Badge>}
                  {item.status === "changed" && <Badge variant="outline">Updated in Google</Badge>}
                </li>
              );
            })}
          </ul>
          {hasAllDay && (
            <p className="text-xs text-muted-foreground">
              All-day events start unticked because they are often holidays or reminders rather than busy time.
            </p>
          )}
        </fieldset>
      )}

      <ActionBar
        summary={
          selected.size === 0
            ? "Tick at least one event to block it."
            : `${selected.size} ${selected.size === 1 ? "event" : "events"} will become blocked time.`
        }
      >
        <Button variant="ghost" onClick={() => void discard()} disabled={isDiscarding || isImporting}>
          Discard
        </Button>
        <Button
          onClick={() => void confirm()}
          disabled={selected.size === 0 || isImporting}
          aria-busy={isImporting}
        >
          {isImporting && <Loader2 className="animate-spin" />}
          Block {selected.size} {selected.size === 1 ? "event" : "events"}
        </Button>
      </ActionBar>
    </PageShell>
  );
}

// ─── Google Classroom ───────────────────────────────────────────────────────

interface Draft {
  selected: boolean;
  category: Category;
  priority: Priority;
  estimate: string;
}

function ClassroomReview({
  importId,
  items,
  expiresAt,
}: {
  importId: string;
  items: ClassroomItem[];
  expiresAt: string;
}) {
  const timeZone = useAccountTimezone();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        {
          selected: item.status === "new",
          category: item.suggestedCategory,
          priority: "Medium" as Priority,
          estimate: String(DEFAULT_ESTIMATE_MINUTES),
        },
      ]),
    ),
  );
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<googleImport.ClassroomImportResult | null>(null);
  const { discard, isDiscarding } = useDiscard(importId, "/tasks");

  const selectedItems = items.filter((item) => drafts[item.id]?.selected);
  const invalidEstimate = selectedItems.some((item) => !validEstimate(drafts[item.id].estimate));
  const totalMinutes = selectedItems.reduce(
    (sum, item) => sum + (validEstimate(drafts[item.id].estimate) ? Number(drafts[item.id].estimate) : 0),
    0,
  );

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function confirm() {
    setIsImporting(true);
    setError(null);
    try {
      const outcome = await googleImport.importClassroomItems(
        importId,
        selectedItems.map((item) => ({
          id: item.id,
          category: drafts[item.id].category,
          priority: drafts[item.id].priority,
          estimateMinutes: Number(drafts[item.id].estimate),
        })),
      );
      setResult(outcome);
      toast.success("Google Classroom coursework imported");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setIsImporting(false);
    }
  }

  if (result) {
    const titles = new Map(items.map((item) => [item.id, item.title]));
    return (
      <PageShell width="narrow">
        <StepFlow steps={IMPORT_STEPS} current={IMPORT_STEPS.length} label="Import steps" />
        <PageHeader icon={GraduationCap} eyebrow="Google Classroom" title="Google Classroom import finished" />
        <Callout
          tone="success"
          title={`${result.createdTaskIds.length} ${result.createdTaskIds.length === 1 ? "task" : "tasks"} added`}
          actions={
            <>
              <Button size="sm" nativeButton={false} render={<Link href="/tasks" />}>
                Go to Tasks
              </Button>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/calendar" />}>
                Open Calendar
              </Button>
            </>
          }
        >
          {result.alreadyImported.length > 0 &&
            `${result.alreadyImported.length} ${
              result.alreadyImported.length === 1 ? "was" : "were"
            } already in StudyFlow and left as ${
              result.alreadyImported.length === 1 ? "it is" : "they are"
            }. `}
          Generate a plan from the Calendar to schedule study time for the new tasks.
        </Callout>
        {result.failed.length > 0 && (
          <Callout tone="warning" title="Some coursework was not added">
            <ul className="list-inside list-disc">
              {result.failed.map((failure) => (
                <li key={failure.id}>
                  {titles.get(failure.id) ?? "An item"}:{" "}
                  {failure.reason === "deadline_passed"
                    ? "its due date has already passed."
                    : "it could not be saved."}
                </li>
              ))}
            </ul>
          </Callout>
        )}
      </PageShell>
    );
  }

  return (
    <PageShell width="narrow">
      <StepFlow steps={IMPORT_STEPS} current={1} label="Import steps" />
      <PageHeader
        icon={GraduationCap}
        eyebrow="Google Classroom"
        title="Review your Google Classroom coursework"
        description="Choose what to add as tasks. Classroom does not know how long work takes, so give each one an estimate."
      />
      <ExpiryNote expiresAt={expiresAt} />
      {error && <Callout tone="danger">{error}</Callout>}

      {items.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No open coursework found">
          None of your active Google Classroom classes has coursework that is still due and not
          turned in.
        </EmptyState>
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="sr-only">Google Classroom coursework</legend>
          <p className="text-xs tabular-nums text-muted-foreground">
            {selectedItems.length} of {items.filter((item) => item.status === "new").length} selected
          </p>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((item) => {
              const draft = drafts[item.id];
              const disabled = item.status === "already_imported";
              const checkboxId = `classroom-${item.id}`;
              const estimateId = `estimate-${item.id}`;
              const estimateInvalid = draft.selected && !validEstimate(draft.estimate);
              return (
                <li
                  key={item.id}
                  className={cn(
                    "space-y-3 px-4 py-3.5 transition-colors duration-150 compact:py-2.5",
                    draft.selected && !disabled && "bg-primary/[0.03]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={checkboxId}
                      className="mt-0.5"
                      checked={draft.selected}
                      disabled={disabled}
                      onCheckedChange={(checked) => update(item.id, { selected: checked === true })}
                    />
                    <Label
                      htmlFor={checkboxId}
                      className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 font-normal"
                    >
                      <span className="block wrap-break-word font-medium">{item.title}</span>
                      <span className="block wrap-break-word text-xs text-muted-foreground">
                        {item.course ? `${item.course} · ` : ""}Due {formatDateTime(item.dueAt, timeZone)}
                      </span>
                    </Label>
                    {disabled ? (
                      <Badge variant="secondary">Already a task</Badge>
                    ) : (
                      <DueChip deadline={item.dueAt} />
                    )}
                    {item.link && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={`Open ${item.title} in Google Classroom`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>

                  {draft.selected && !disabled && (
                    <div className="rise-in space-y-2.5 ps-7">
                      <div className="grid gap-3 @xl/dashboard:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
                        <div className="space-y-1">
                          <Label className="eyebrow">Category</Label>
                          <Select
                            value={draft.category}
                            onValueChange={(value) => value && update(item.id, { category: value as Category })}
                          >
                            <SelectTrigger className="w-full" aria-label={`Category for ${item.title}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map((category) => (
                                <SelectItem key={category} value={category}>
                                  {category}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="eyebrow">Priority</Label>
                          <Select
                            value={draft.priority}
                            onValueChange={(value) => value && update(item.id, { priority: value as Priority })}
                          >
                            <SelectTrigger className="w-full" aria-label={`Priority for ${item.title}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PRIORITIES.map((priority) => (
                                <SelectItem key={priority} value={priority}>
                                  {priority}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={estimateId} className="eyebrow">
                            Estimate (minutes)
                          </Label>
                          <Input
                            id={estimateId}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={MAX_ESTIMATE_MINUTES}
                            step={5}
                            value={draft.estimate}
                            onChange={(event) => update(item.id, { estimate: event.target.value })}
                            aria-invalid={estimateInvalid || undefined}
                          />
                        </div>
                      </div>
                      {/* Most coursework lands near one of these, so a tap beats typing. */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="me-1 text-xs text-muted-foreground">Quick estimate</span>
                        {ESTIMATE_PRESETS.map((minutes) => {
                          const active = Number(draft.estimate) === minutes;
                          return (
                            <Button
                              key={minutes}
                              type="button"
                              size="xs"
                              variant={active ? "secondary" : "outline"}
                              aria-pressed={active}
                              aria-label={`Estimate ${formatDuration(minutes)} for ${item.title}`}
                              onClick={() => update(item.id, { estimate: String(minutes) })}
                              className={cn("tabular-nums", active && "text-foreground")}
                            >
                              {formatDuration(minutes)}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {invalidEstimate && (
            <p className="text-xs text-destructive" role="alert">
              Every selected item needs an estimate between 1 and {MAX_ESTIMATE_MINUTES} minutes.
            </p>
          )}
        </fieldset>
      )}

      <ActionBar
        summary={
          selectedItems.length === 0
            ? "Tick at least one piece of coursework to add it."
            : `${formatDuration(totalMinutes)} of work across ${selectedItems.length} ${selectedItems.length === 1 ? "task" : "tasks"}.`
        }
      >
        <Button variant="ghost" onClick={() => void discard()} disabled={isDiscarding || isImporting}>
          Discard
        </Button>
        <Button
          onClick={() => void confirm()}
          disabled={selectedItems.length === 0 || invalidEstimate || isImporting}
          aria-busy={isImporting}
        >
          {isImporting && <Loader2 className="animate-spin" />}
          Add {selectedItems.length} {selectedItems.length === 1 ? "task" : "tasks"}
        </Button>
      </ActionBar>
    </PageShell>
  );
}

function validEstimate(value: string): boolean {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_ESTIMATE_MINUTES;
}
