"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, Clock } from "lucide-react";
import { mockUser } from "@/lib/mock-data";

const timezones = [
  {
    group: "Asia",
    items: [
      { value: "Asia/Phnom_Penh", label: "Indochina Time (Phnom Penh, Bangkok)", offset: "+07:00" },
      { value: "Asia/Tokyo",      label: "Japan Standard Time (Tokyo)",           offset: "+09:00" },
      { value: "Asia/Kolkata",    label: "India Standard Time (New Delhi)",        offset: "+05:30" },
      { value: "Asia/Shanghai",   label: "China Standard Time (Shanghai)",         offset: "+08:00" },
    ],
  },
  {
    group: "Americas",
    items: [
      { value: "America/New_York",    label: "Eastern Time (New York)",   offset: "-05:00" },
      { value: "America/Chicago",     label: "Central Time (Chicago)",    offset: "-06:00" },
      { value: "America/Denver",      label: "Mountain Time (Denver)",    offset: "-07:00" },
      { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)", offset: "-08:00" },
    ],
  },
  {
    group: "Europe",
    items: [
      { value: "Europe/London", label: "GMT / British Time (London)",    offset: "+00:00" },
      { value: "Europe/Paris",  label: "Central European Time (Paris)",  offset: "+01:00" },
    ],
  },
  {
    group: "Oceania",
    items: [
      { value: "Australia/Sydney", label: "Australian Eastern Time (Sydney)", offset: "+10:00" },
    ],
  },
];

const allTimezones = timezones.flatMap((g) => g.items);

export default function TimezoneSettingsPage() {
  const [selected, setSelected] = useState(mockUser.timezone);
  const [localTime, setLocalTime] = useState("");

  useEffect(() => {
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

  const selectedTz = allTimezones.find((t) => t.value === selected);

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Timezone</h2>
        <p className="text-sm text-muted-foreground">
          Your timezone is used to interpret deadlines and schedule sessions correctly.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">

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
              <p className="text-sm font-semibold font-mono">{selectedTz?.offset ?? "—"}</p>
            </div>
          </div>

          <Separator />

          {/* Selector */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Select Timezone</Label>
            <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {timezones.map((group) => (
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
          </div>

          {/* Info note */}
          <div className="rounded-lg border bg-amber-50 border-amber-200 px-4 py-3 text-xs text-amber-800">
            <p>
              Changing timezone preserves the absolute moment of each deadline.
              A 11:59 PM deadline moves to the equivalent UTC moment in your new zone.
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm">Save timezone</Button>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
