"use client";

import * as React from "react";
import { Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/ui/callout";
import { ApiError, account as accountApi } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { notifyStudyFlowSessionInvalidated } from "@/lib/data-events";
import { formatOffset, withTimezone } from "@/lib/timezones";
import type { WireAccountProfile, WireStudyPreferences } from "@/lib/api/wire";

/**
 * The two settings that are consequential enough to interrupt for.
 *
 * Everything else on the settings page edits in place. A password change needs
 * the current password and cannot be undone by a browser back button, and a
 * timezone change moves every displayed deadline — both deserve a deliberate
 * moment rather than a field that saves as you leave it.
 */
export function AddPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [isSaving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNext("");
      setConfirm("");
      setError(null);
    }
  }

  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSave = next.length >= 12 && confirm === next && !isSaving;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await accountApi.setPassword(next);
      toast.success("Password added. Please sign in again.");
      notifyStudyFlowSessionInvalidated();
      onOpenChange(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a password</DialogTitle>
          <DialogDescription>
            You currently sign in with Google. Add a password so you can also sign in with your
            email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error && <Callout tone="danger">{error}</Callout>}

          <div className="space-y-1.5">
            <Label htmlFor="add-password-new" className="eyebrow">
              New password
            </Label>
            <PasswordInput
              key={String(open)}
              id="add-password-new"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-invalid={tooShort || undefined}
            />
            {tooShort && (
              <p className="text-xs text-deficit">
                {12 - next.length} more {12 - next.length === 1 ? "character" : "characters"} needed.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-password-confirm" className="eyebrow">
              Repeat new password
            </Label>
            <PasswordInput
              key={String(open)}
              id="add-password-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch || undefined}
            />
            {mismatch && <p className="text-xs text-deficit">These do not match.</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {isSaving && <Loader2 className="animate-spin" />}
            Add password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [isSaving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
    }
  }

  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSave = current.length > 0 && next.length >= 12 && confirm === next && !isSaving;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await accountApi.changePassword(current, next);
      toast.success("Password changed. Please sign in again.");
      notifyStudyFlowSessionInvalidated();
      onOpenChange(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Use at least 12 characters. Common and breached passwords are rejected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error && <Callout tone="danger">{error}</Callout>}

          <div className="space-y-1.5">
            <Label htmlFor="current-password" className="eyebrow">
              Current password
            </Label>
            <PasswordInput
              key={String(open)}
              id="current-password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="eyebrow">
              New password
            </Label>
            <PasswordInput
              key={String(open)}
              id="new-password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-invalid={tooShort || undefined}
            />
            {tooShort && (
              <p className="text-xs text-deficit">
                {12 - next.length} more{" "}
                {12 - next.length === 1 ? "character" : "characters"} needed.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="eyebrow">
              Repeat new password
            </Label>
            <PasswordInput
              key={String(open)}
              id="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch || undefined}
            />
            {mismatch && <p className="text-xs text-deficit">These do not match.</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {isSaving && <Loader2 className="animate-spin" />}
            Change password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChangeTimezoneDialog({
  open,
  onOpenChange,
  preferences,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: WireStudyPreferences | null;
  onSaved: (next: WireStudyPreferences) => void;
}) {
  const [selected, setSelected] = React.useState("");
  const [isSaving, setSaving] = React.useState(false);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && preferences) setSelected(preferences.timezone);
  }

  const groups = withTimezone(selected);
  const isDirty = preferences !== null && selected !== "" && selected !== preferences.timezone;

  async function save() {
    if (!preferences) return;
    setSaving(true);
    try {
      // Preferences replace wholesale, so the untouched settings ride along.
      const saved = await accountApi.updatePreferences({
        timezone: selected,
        preferredSessionLength: preferences.preferred_session_length_minutes,
        minimumBreak: preferences.minimum_break_minutes,
      });
      onSaved(saved);
      toast.success("Timezone saved");
      onOpenChange(false);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change timezone</DialogTitle>
          <DialogDescription>
            Used to read your deadlines and place your study sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Select value={selected} onValueChange={(next) => next && setSelected(next)}>
            <SelectTrigger className="h-10 w-full">
              <Globe className="text-muted-foreground" />
              <SelectValue placeholder="Choose a timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {groups.map((group) => (
                <SelectGroup key={group.group}>
                  <SelectLabel>{group.group}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label} · {formatOffset(item.value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          {isDirty && (
            <Callout tone="info" title="Your deadlines do not move">
              A deadline stays at the same moment in time, so it will show at a different
              clock time here. Your weekly study hours keep their clock times, so check
              they are still when you are free.
            </Callout>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!isDirty || isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Save timezone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renaming is one field, but it is still an edit — it gets a moment too. */
export function ChangeNameDialog({
  open,
  onOpenChange,
  currentName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onSaved: (next: WireAccountProfile) => void;
}) {
  const [name, setName] = React.useState(currentName);
  const [isSaving, setSaving] = React.useState(false);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName(currentName);
  }

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== currentName && !isSaving;

  async function save() {
    setSaving(true);
    try {
      const saved = await accountApi.updateProfile(trimmed);
      onSaved(saved);
      toast.success("Name saved");
      onOpenChange(false);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change your name</DialogTitle>
          <DialogDescription>This is how StudyFlow greets you.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="display-name" className="eyebrow">
            Name
          </Label>
          <Input
            id="display-name"
            value={name}
            maxLength={200}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSave) void save();
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {isSaving && <Loader2 className="animate-spin" />}
            Save name
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccountDeletionDialog({
  open,
  onOpenChange,
  passwordSet,
  googleReady,
  onStartGoogle,
  onGoogleChallengeExpired,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passwordSet: boolean | null;
  googleReady: boolean;
  onStartGoogle: () => Promise<void>;
  onGoogleChallengeExpired: () => void;
  onDeleted: () => void;
}) {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setSubmitting] = React.useState(false);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCurrentPassword("");
      setConfirmation("");
      setError(null);
    }
  }

  const canContinue = passwordSet !== null && confirmation === "DELETE" && !isSubmitting;

  async function submit() {
    if (!canContinue) return;
    setSubmitting(true);
    setError(null);
    try {
      if (passwordSet) {
        await accountApi.prepareDeletion(currentPassword);
      }
      await accountApi.confirmDeletion();
      toast.success("Account deleted successfully. Please sign in again.");
      onDeleted();
    } catch (cause) {
      if (!passwordSet && googleReady && cause instanceof ApiError && cause.status === 400) {
        onGoogleChallengeExpired();
      }
      setError(describeError(cause));
      setSubmitting(false);
    }
  }

  async function startGoogle() {
    setSubmitting(true);
    setError(null);
    try {
      await onStartGoogle();
    } catch (cause) {
      setError(describeError(cause));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This permanently deletes your profile, sign-in methods, tasks, schedules, sessions,
            and progress. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error && <Callout tone="danger">{error}</Callout>}

          {passwordSet === null ? (
            <Callout tone="warning">Loading your account details before deletion.</Callout>
          ) : passwordSet ? (
            <div className="space-y-1.5">
              <Label htmlFor="delete-account-password" className="eyebrow">
                Current password
              </Label>
              <PasswordInput
                key={String(open)}
                id="delete-account-password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={isSubmitting}
                autoFocus
              />
            </div>
          ) : googleReady ? (
            <Callout tone="success">Google reauthentication complete.</Callout>
          ) : (
            <Callout tone="warning">
              Reauthenticate with Google before deleting this account.
            </Callout>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="delete-account-confirmation" className="eyebrow">
              Type DELETE to confirm
            </Label>
            <Input
              id="delete-account-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={isSubmitting}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          {passwordSet === null ? (
            <Button variant="destructive" disabled>
              Loading account details
            </Button>
          ) : !passwordSet && !googleReady ? (
            <Button
              variant="destructive"
              onClick={() => void startGoogle()}
              disabled={!canContinue}
            >
              {isSubmitting && <Loader2 className="animate-spin" />}
              Continue with Google
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => void submit()}
              disabled={!canContinue || (passwordSet && currentPassword.length === 0)}
            >
              {isSubmitting && <Loader2 className="animate-spin" />}
              Delete account
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
