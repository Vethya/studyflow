"use client";

import { createContext, useCallback, useContext } from "react";
import { Loader2 } from "lucide-react";
import { account } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { SWR_KEYS } from "@/lib/swr-keys";
import { Button } from "@/components/ui/button";
import { detectTimezone } from "@/lib/timezones";

const AccountTimezoneContext = createContext(detectTimezone());

export function AccountTimezoneProvider({ children }: { children: React.ReactNode }) {
  const loadPreferences = useCallback((signal: AbortSignal) => account.getPreferences(signal), []);
  const preferences = useApi(SWR_KEYS.studyPreferences, loadPreferences);

  if (preferences.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading account timezone…</span>
      </div>
    );
  }

  if (!preferences.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm">
        <p>Could not load your account timezone.</p>
        <Button variant="outline" onClick={preferences.reload}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <AccountTimezoneContext.Provider value={preferences.data.timezone}>
      {children}
    </AccountTimezoneContext.Provider>
  );
}

export function useAccountTimezone(): string {
  return useContext(AccountTimezoneContext);
}
