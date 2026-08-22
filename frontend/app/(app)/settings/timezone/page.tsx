"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { account as accountApi, availability } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { detectTimezone, formatOffset, withTimezone } from "@/lib/timezones";

export default function TimezoneSettingsPage() {
  const load = useCallback((signal: AbortSignal) => accountApi.getPreferences(signal), []);
  const { data, error, isLoading, reload, setData } = useApi(load);

  const [selected, setSelected] = useState("");
  const [localTime, setLocalTime] = useState("—");
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  // Re-seed the selection whenever fresh preferences arrive.
  const [synced, setSynced] = useState(data);
  if (data !== synced) {
    setSynced(data);
    if (data) setSelected(data.timezone);
  }

  useEffect(() => {
    if (!selected) return;
    const update = () => {
      try {
        setLocalTime(
          new Date().toLocaleTimeString("en-US", {
            timeZone: selected,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          })
        );
      } catch {
        setLocalTime("—");
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [selected]);

  const isDirty = data !== null && selected !== "" && selected !== data.timezone;
  const detected = detectTimezone();

  async function handleSave() {
    if (!data) return;
    setIsSaving(true);
    try {
      // Preferences are replaced wholesale, so the session and break settings
      // are echoed back untouched.
      const saved = await accountApi.updatePreferences({
        timezone: selected,
        preferredSessionLength: data.preferred_session_length_minutes,
        minimumBreak: data.minimum_break_minutes,
      });
      setData(saved);
      toast.success("Timezone saved");
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirm() {
    setIsConfirming(true);
    try {
      await availability.confirmTimezone();
      toast.success("Timezone confirmed");
      reload();
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Timezone</h2>
        <p className="text-sm text-muted-foreground">
          Your timezone is used to interpret deadlines and schedule sessions correctly.
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
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              {/* Backend flag: the student has never acknowledged their zone. */}
              {data.availability_confirmation_required && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between gap-4">
                    <span>
                      Confirm your timezone so your availability can be scheduled.
                    </span>
                    <Button size="sm" onClick={handleConfirm} disabled={isConfirming}>
                      {isConfirming && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      Confirm
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Current time display */}
              <div className="flex items-center gap-4 rounded-lg border bg-muted/40 px-4 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background border">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Current time in selected timezone</p>
                  <p className="text-xl font-bold tabular-nums tracking-tight mt-0.5">
                    {localTime}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">UTC offset</p>
                  <p className="text-sm font-semibold font-mono">
                    {selected ? formatOffset(selected) : "—"}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Selector */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Select Timezone</Label>
                <Select
                  value={selected}
                  onValueChange={(v) => v && setSelected(v as string)}
                  disabled={isSaving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {withTimezone(selected).map((group) => (
                      <SelectGroup key={group.group}>
                        <SelectLabel>{group.group}</SelectLabel>
                        {group.items.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground w-14 shrink-0">
                                {tz.offset}
                              </span>
                              {tz.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {detected !== selected && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setSelected(detected)}
                  >
                    This browser reports {detected} — use that instead
                  </button>
                )}
              </div>

              {/* Info note */}
              <div className="rounded-lg border bg-amber-50 border-amber-200 px-4 py-3 text-xs text-amber-800">
                <p>
                  Changing timezone preserves the absolute moment of each deadline.
                  A 11:59 PM deadline moves to the equivalent UTC moment in your new zone.
                </p>
              </div>

              <div className="flex justify-end">
                <Button size="sm" onClick={handleSave} disabled={!isDirty || isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Save timezone
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
