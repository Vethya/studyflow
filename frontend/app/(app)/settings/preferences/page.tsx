"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { mockUser } from "@/lib/mock-data";

export default function PreferencesSettingsPage() {
  const [sessionLength, setSessionLength] = useState(mockUser.preferredSessionLength);
  const [breakLength, setBreakLength] = useState(mockUser.minimumBreak);
  const [minSession, setMinSession] = useState(20);

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Control how StudyFlow schedules your study sessions.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">

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
              onValueChange={(vals) => { if (typeof vals !== "number") setSessionLength((vals as number[])[0]); }}
              min={20}
              max={180}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>20 min</span>
              <span>60 min</span>
              <span>120 min</span>
              <span>180 min</span>
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
              onValueChange={(vals) => { if (typeof vals !== "number") setBreakLength((vals as number[])[0]); }}
              min={0}
              max={60}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0 min</span>
              <span>15 min</span>
              <span>30 min</span>
              <span>60 min</span>
            </div>
          </div>

          <Separator />

          {/* Minimum session length */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-medium">Minimum Session Length</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Sessions shorter than this won't be scheduled
                </p>
              </div>
              <div className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                {minSession}
                <span className="text-xs font-normal text-muted-foreground">min</span>
              </div>
            </div>
            <Slider
              value={[minSession]}
              onValueChange={(vals) => { if (typeof vals !== "number") setMinSession((vals as number[])[0]); }}
              min={10}
              max={60}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>10 min</span>
              <span>30 min</span>
              <span>60 min</span>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-0.5">
            <p>
              StudyFlow will schedule sessions of{" "}
              <strong className="text-foreground">{sessionLength} min</strong> with at least{" "}
              <strong className="text-foreground">{breakLength} min</strong> breaks, and skip any slot shorter than{" "}
              <strong className="text-foreground">{minSession} min</strong>.
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm">Save preferences</Button>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
