import { Suspense, useState } from "react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { SessionProvider } from "@/hooks/use-session";
import { AccountTimezoneProvider } from "@/hooks/use-account-timezone";
import { StudyFlowSWRProvider } from "@/components/swr-provider";

export function StoryProviders({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new Map());
  return <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
    <StudyFlowSWRProvider><SessionProvider><AccountTimezoneProvider>
      <Suspense fallback={<p>Loading story…</p>}>{children}</Suspense>
    </AccountTimezoneProvider></SessionProvider></StudyFlowSWRProvider>
  </SWRConfig>;
}
