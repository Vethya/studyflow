"use client";

import { SWRConfig, useSWRConfig } from "swr";
import { useEffect } from "react";
import {
  STUDYFLOW_DATA_CHANGED_EVENT,
  type StudyFlowDataChangedDetail,
} from "@/lib/data-events";
import { SWR_KEYS } from "@/lib/swr-keys";

const ALL_CACHE_ROOTS: string[] = [
  ...Object.values(SWR_KEYS),
  "studyflow/task",
  "studyflow/adaptive-estimate",
];

function rootForKey(key: unknown): string | null {
  const root = Array.isArray(key) ? key[0] : key;
  return typeof root === "string" ? root : null;
}

function rootsForMutation(path: string): string[] {
  if (path === "/tasks" || path.startsWith("/tasks/")) {
    return [
      SWR_KEYS.tasks,
      "studyflow/task",
      "studyflow/adaptive-estimate",
      SWR_KEYS.activeSchedule,
      SWR_KEYS.pendingRevision,
      SWR_KEYS.effortProgress,
    ];
  }
  if (path.startsWith("/availability/")) {
    return [
      SWR_KEYS.availabilityWindows,
      SWR_KEYS.unavailablePeriods,
      SWR_KEYS.studyPreferences,
      SWR_KEYS.activeSchedule,
      SWR_KEYS.pendingRevision,
      SWR_KEYS.effortProgress,
    ];
  }
  if (path === "/account/profile") return [SWR_KEYS.profile, SWR_KEYS.session];
  if (path === "/account/password") return [];
  if (path === "/account/preferences") {
    return [
      SWR_KEYS.studyPreferences,
      SWR_KEYS.activeSchedule,
      SWR_KEYS.pendingRevision,
      SWR_KEYS.effortProgress,
    ];
  }
  if (path === "/account/identities") return [SWR_KEYS.identities];
  if (path.startsWith("/account/deletion/")) return [SWR_KEYS.deletionStatus];
  if (path.startsWith("/adaptive-estimates/")) return ["studyflow/adaptive-estimate"];
  if (path === "/schedule-proposals") return [SWR_KEYS.pendingRevision];
  if (path.endsWith("/reject")) return [SWR_KEYS.pendingRevision];
  if (path.startsWith("/schedule-proposals/")) {
    return [SWR_KEYS.activeSchedule, SWR_KEYS.pendingRevision, SWR_KEYS.effortProgress];
  }
  if (path.startsWith("/study-sessions/")) {
    return [
      SWR_KEYS.tasks,
      "studyflow/task",
      "studyflow/adaptive-estimate",
      SWR_KEYS.activeSchedule,
      SWR_KEYS.pendingRevision,
      SWR_KEYS.effortProgress,
    ];
  }
  return ALL_CACHE_ROOTS;
}

/** Shared server-state policy for the authenticated StudyFlow app. */
function StudyFlowDataChangeListener() {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    const onDataChanged = (event: Event) => {
      const detail = (event as CustomEvent<StudyFlowDataChangedDetail | undefined>).detail;
      const roots = detail ? rootsForMutation(detail.path) : ALL_CACHE_ROOTS;
      void mutate((key) => {
        const root = rootForKey(key);
        return root !== null && roots.includes(root);
      });
    };
    window.addEventListener(STUDYFLOW_DATA_CHANGED_EVENT, onDataChanged);
    return () => window.removeEventListener(STUDYFLOW_DATA_CHANGED_EVENT, onDataChanged);
  }, [mutate]);

  return null;
}

export function StudyFlowSWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 30_000,
        refreshInterval: 0,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        shouldRetryOnError: false,
      }}
    >
      <StudyFlowDataChangeListener />
      {children}
    </SWRConfig>
  );
}
