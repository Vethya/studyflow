"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Shield, Monitor, Smartphone, LogOut } from "lucide-react";

const activeSessions = [
  {
    id: "s1",
    device: "Chrome on Windows",
    icon: Monitor,
    location: "Phnom Penh, KH",
    lastActive: "Now — current session",
    isCurrent: true,
  },
  {
    id: "s2",
    device: "Safari on iPhone",
    icon: Smartphone,
    location: "Phnom Penh, KH",
    lastActive: "2 hours ago",
    isCurrent: false,
  },
];

export default function SecuritySettingsPage() {
  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Security</h2>
        <p className="text-sm text-muted-foreground">
          Manage your password and active sessions.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">

          {/* Password */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Change Password</h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="current-pw" className="text-xs font-medium">Current Password</Label>
                <Input id="current-pw" type="password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-pw" className="text-xs font-medium">New Password</Label>
                <Input id="new-pw" type="password" />
                <p className="text-[11px] text-muted-foreground">At least 12 characters.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-pw" className="text-xs font-medium">Confirm Password</Label>
                <Input id="confirm-pw" type="password" />
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button size="sm">Update password</Button>
            </div>
          </div>

          <Separator />

          {/* Active sessions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Active Sessions</h3>
              <Badge className="bg-muted text-muted-foreground border-0 text-[11px]">
                {activeSessions.length} sessions
              </Badge>
            </div>

            <div className="space-y-2">
              {activeSessions.map((session) => {
                const Icon = session.icon;
                return (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-lg border p-3.5 gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{session.device}</span>
                          {session.isCurrent && (
                            <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[10px] h-4 px-1.5">
                              Current
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {session.location} · {session.lastActive}
                        </p>
                      </div>
                    </div>
                    {!session.isCurrent && (
                      <Button variant="ghost" size="sm" className="shrink-0 h-8 text-muted-foreground hover:text-destructive">
                        <LogOut className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/20"
            >
              <Shield className="mr-2 h-4 w-4" />
              Sign out all other sessions
            </Button>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
