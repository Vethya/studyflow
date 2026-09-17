"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, PageShell } from "@/components/page-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, googleImport } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "@/types/task";

type CalendarItem = googleImport.CalendarImportItem;
type ClassroomItem = googleImport.ClassroomImportItem;

const DEFAULT_ESTIMATE_MINUTES = 60;
const MAX_ESTIMATE_MINUTES = 7 * 24 * 60;

function formatDateTime(value: string, allDay = false): string {
  const date = new Date(value);
  return allDay
    ? date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
    : date.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
}

function formatRange(item: CalendarItem): string {
  if (item.allDay) {
    // All-day events end at midnight after their last day.
    const lastDay = new Date(new Date(item.endsAt).getTime() - 1).toISOString();
    const first = formatDateTime(item.startsAt, true);
    const last = formatDateTime(lastDay, true);
    return first === last ? `${first}, all day` : `${first} – ${last}, all day`;
  }
  const end = new Date(item.endsAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatDateTime(item.startsAt)} – ${end}`;
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your import…
        </div>
      </PageShell>
    );
  }

  if (preview.error || !preview.data) {
    const expired = preview.error instanceof ApiError && preview.error.isNotFound;
    return (
      <PageShell width="narrow">
        <PageHeader title="Google import" />
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

function ExpiryNote({ expiresAt }: { expiresAt: string }) {
  const time = new Date(expiresAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <p className="text-xs text-muted-foreground">
      This list is kept only until {time}. Nothing is added until you confirm.
    </p>
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
        <PageHeader title="Google Calendar import finished" />
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
      <PageHeader
        title="Review your Google Calendar events"
        description="Choose the events you cannot study during. Each one becomes blocked time on your Availability page."
      />
      <ExpiryNote expiresAt={expiresAt} />
      {error && <Callout tone="danger">{error}</Callout>}

      {items.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No busy events found">
          Your primary Google Calendar has no upcoming events that mark you as busy in this range.
        </EmptyState>
      ) : (
        <fieldset className="space-y-2">
          <legend className="sr-only">Google Calendar events</legend>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {selected.size} of {selectable.length} selected
            </span>
            <span className="flex gap-2">
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
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const disabled = item.status === "unchanged";
              const checkboxId = `calendar-${item.id}`;
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <Checkbox
                    id={checkboxId}
                    className="mt-0.5"
                    checked={selected.has(item.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) => toggle(item.id, checked === true)}
                  />
                  <Label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 font-normal">
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="block text-xs text-muted-foreground">{formatRange(item)}</span>
                  </Label>
                  {item.status === "unchanged" && <Badge variant="secondary">Already imported</Badge>}
                  {item.status === "changed" && <Badge variant="outline">Updated in Google</Badge>}
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <div className="flex flex-wrap justify-end gap-2">
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
      </div>
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
        <PageHeader title="Google Classroom import finished" />
        <Callout
          tone="success"
          title={`${result.createdTaskIds.length} ${result.createdTaskIds.length === 1 ? "task" : "tasks"} added`}
          actions={
            <Button size="sm" nativeButton={false} render={<Link href="/tasks" />}>
              Go to Tasks
            </Button>
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
      <PageHeader
        title="Review your Google Classroom coursework"
        description="Choose what to add as tasks. Classroom does not know how long work takes, so set an estimate for each one."
      />
      <ExpiryNote expiresAt={expiresAt} />
      {error && <Callout tone="danger">{error}</Callout>}

      {items.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No open coursework found">
          None of your active Google Classroom classes has coursework that is still due and not
          turned in.
        </EmptyState>
      ) : (
        <fieldset className="space-y-2">
          <legend className="sr-only">Google Classroom coursework</legend>
          <p className="text-xs text-muted-foreground">
            {selectedItems.length} of {items.filter((item) => item.status === "new").length} selected
          </p>
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const draft = drafts[item.id];
              const disabled = item.status === "already_imported";
              const checkboxId = `classroom-${item.id}`;
              const estimateId = `estimate-${item.id}`;
              const estimateInvalid = draft.selected && !validEstimate(draft.estimate);
              return (
                <li key={item.id} className="space-y-3 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={checkboxId}
                      className="mt-0.5"
                      checked={draft.selected}
                      disabled={disabled}
                      onCheckedChange={(checked) => update(item.id, { selected: checked === true })}
                    />
                    <Label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 font-normal">
                      <span className="block font-medium">{item.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.course ? `${item.course} · ` : ""}Due {formatDateTime(item.dueAt)}
                      </span>
                    </Label>
                    {disabled && <Badge variant="secondary">Already a task</Badge>}
                    {item.link && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${item.title} in Google Classroom`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>

                  {draft.selected && !disabled && (
                    <div className="grid gap-3 pl-7 sm:grid-cols-3">
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

      <div className="flex flex-wrap justify-end gap-2">
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
      </div>
    </PageShell>
  );
}

function validEstimate(value: string): boolean {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_ESTIMATE_MINUTES;
}
