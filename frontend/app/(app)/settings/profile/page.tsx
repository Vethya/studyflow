"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Upload, Camera, CheckCircle2 } from "lucide-react";
import { mockUser } from "@/lib/mock-data";

const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

export default function ProfileSettingsPage() {
  const initials = mockUser.name.split(" ").map((n) => n[0]).join("");

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">
          Your public profile and linked accounts.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">

          {/* Avatar section */}
          <div className="flex items-center gap-5">
            <div className="relative">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg font-semibold bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <button className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted shadow-sm hover:bg-accent transition-colors">
                <Camera className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">{mockUser.name}</p>
              <p className="text-xs text-muted-foreground">{mockUser.email}</p>
              <Button variant="outline" size="sm" className="mt-1 h-7 text-xs">
                <Upload className="mr-1.5 h-3 w-3" />
                Upload photo
              </Button>
            </div>
          </div>

          <Separator />

          {/* Personal info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Personal Information</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="full-name" className="text-xs font-medium">Full Name</Label>
                <Input id="full-name" defaultValue={mockUser.name} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium">Email Address</Label>
                <div className="relative">
                  <Input id="email" defaultValue={mockUser.email} disabled className="pr-24 bg-muted/50" />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[11px] flex items-center gap-1 h-5">
                      <CheckCircle2 className="h-3 w-3" />
                      Verified
                    </Badge>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Email cannot be changed.</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button size="sm">Save changes</Button>
          </div>

          <Separator />

          {/* Linked accounts */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Linked Accounts</h3>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-white shadow-sm">
                  <GoogleIcon />
                </div>
                <div>
                  <p className="text-sm font-medium">Google</p>
                  <p className="text-xs text-muted-foreground">{mockUser.email}</p>
                </div>
              </div>
              {mockUser.hasGoogleLinked ? (
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20">
                  Disconnect
                </Button>
              ) : (
                <Button variant="outline" size="sm">Connect</Button>
              )}
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
