"use client";

import { useState } from "react";
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
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { tasks as tasksApi } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { localInputToIso, nowLocalInput } from "@/lib/datetime";
import { CATEGORIES } from "@/types/task";
import type { AcademicTask, Category } from "@/types/task";

/**
 * SPEC §17.2 "Quick Add Task": the four fields the API actually requires,
 * on one line, so a deadline can be captured without leaving the dashboard.
 * Priority is left at the backend's Medium default; anything more detailed
 * belongs on the Tasks page.
 */
export function QuickAddTask({ onCreated }: { onCreated: (task: AcademicTask) => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Assignment");
  const [deadline, setDeadline] = useState("");
  const [estimate, setEstimate] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const created = await tasksApi.createTask({
        title,
        category,
        priority: "Medium",
        deadline: localInputToIso(deadline),
        originalEstimate: Number(estimate),
      });
      onCreated(created);
      toast.success("Task added");
      setTitle("");
      setDeadline("");
      setEstimate("60");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_11rem_6rem_auto]">
        <div className="space-y-1">
          <Label htmlFor="quick-title" className="eyebrow">
            Task
          </Label>
          <Input
            id="quick-title"
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={isSaving}
            required
          />
        </div>

        <div className="space-y-1">
          <Label className="eyebrow">Category</Label>
          <Select
            value={category}
            onValueChange={(v) => v && setCategory(v as Category)}
            disabled={isSaving}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="quick-deadline" className="eyebrow">
            Deadline
          </Label>
          <Input
            id="quick-deadline"
            type="datetime-local"
            value={deadline}
            min={nowLocalInput()}
            onChange={(e) => setDeadline(e.target.value)}
            disabled={isSaving}
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="quick-estimate" className="eyebrow">
            Minutes
          </Label>
          <Input
            id="quick-estimate"
            type="number"
            min={1}
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            disabled={isSaving}
            required
          />
        </div>

        <div className="flex items-end">
          <Button type="submit" disabled={isSaving} className="w-full sm:w-auto">
            {isSaving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            Add
          </Button>
        </div>
      </div>
    </form>
  );
}
