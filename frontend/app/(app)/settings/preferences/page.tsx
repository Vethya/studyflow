"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { account as accountApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";

/** Ranges enforced by `StudyPreferencesUpdate` on the backend. */
const SESSION_LENGTH = { min: 10, max: 240, step: 5 };
const BREAK_LENGTH = { min: 0, max: 120, step: 5 };

/** Base UI's Slider hands back a number or a tuple depending on its mode. */
function firstValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : value[0];
}

export default function PreferencesSettingsPage() {
  const load = useCallback((signal: AbortSignal) => accountApi.getPreferences(signal), []);
  const { data, error, isLoading, reload, setData } = useApi(load);

  const [sessionLength, setSessionLength] = useState(SESSION_LENGTH.min);
  const [breakLength, setBreakLength] = useState(BREAK_LENGTH.min);
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed the sliders whenever a fresh set of preferences arrives.
  const [synced, setSynced] = useState(data);
  if (data !== synced) {
    setSynced(data);
    if (data) {
      setSessionLength(data.preferred_session_length_minutes);
      setBreakLength(data.minimum_break_minutes);
    }
  }

  const isDirty =
    data !== null &&
    (sessionLength !== data.preferred_session_length_minutes ||
      breakLength !== data.minimum_break_minutes);

  async function handleSave() {
    if (!data) return;
    setIsSaving(true);
    try {
      // The endpoint replaces all three fields, so the unchanged timezone is
      // sent back as-is.
      const saved = await accountApi.updatePreferences({
        timezone: data.timezone,
        preferredSessionLength: sessionLength,
        minimumBreak: breakLength,
      });
      setData(saved);
      toast.success("Preferences saved");
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Control how StudyFlow schedules your study sessions.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{describeError(error)}</span>
            <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-6 space-y-6">
          {isLoading || !data ? (
            <div className="space-y-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <>
              {/* Preferred session length */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-medium">Preferred Session Length</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Target duration for each scheduled study block
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                    {sessionLength}
                    <span className="text-xs font-normal text-muted-foreground">min</span>
                  </div>
                </div>
                <Slider
                  value={[sessionLength]}
                  onValueChange={(value) => setSessionLength(firstValue(value))}
                  min={SESSION_LENGTH.min}
                  max={SESSION_LENGTH.max}
                  step={SESSION_LENGTH.step}
                  className="w-full"
                  disabled={isSaving}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>10 min</span>
                  <span>60 min</span>
                  <span>120 min</span>
                  <span>240 min</span>
                </div>
              </div>

              <Separator />

              {/* Minimum break */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-medium">Minimum Break Between Sessions</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Buffer time scheduled automatically between sessions
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                    {breakLength}
                    <span className="text-xs font-normal text-muted-foreground">min</span>
                  </div>
                </div>
                <Slider
                  value={[breakLength]}
                  onValueChange={(value) => setBreakLength(firstValue(value))}
                  min={BREAK_LENGTH.min}
                  max={BREAK_LENGTH.max}
                  step={BREAK_LENGTH.step}
                  className="w-full"
                  disabled={isSaving}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0 min</span>
                  <span>30 min</span>
                  <span>60 min</span>
                  <span>120 min</span>
                </div>
              </div>

              {/* Summary */}
              <div className="rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-0.5">
                <p>
                  StudyFlow will schedule sessions of{" "}
                  <strong className="text-foreground">{sessionLength} min</strong> with at least{" "}
                  <strong className="text-foreground">{breakLength} min</strong> between them.
                </p>
              </div>

              <div className="flex justify-end">
                <Button size="sm" onClick={handleSave} disabled={!isDirty || isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Save preferences
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
