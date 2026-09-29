import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  WireAcademicTask,
  WireAccountProfile,
  WireAvailabilityWindow,
  WireEffortProgress,
  WireGoogleImportStatus,
  WireScheduleProposal,
  WireStudySession,
  WireStudyPreferences,
  WireUnavailablePeriod,
} from '@studyflow/api';
import { queryKeys } from '@studyflow/api';

import { ApiError, apiRequest } from '../lib/api-client';

export function useTasksQuery(query = '') {
  const params = new URLSearchParams({ limit: '100' });
  if (query.trim()) params.set('query', query.trim());
  return useQuery({
    queryKey: [...queryKeys.tasks, query.trim()],
    queryFn: ({ signal }) => apiRequest<WireAcademicTask[]>(`/tasks?${params.toString()}`, { signal }),
  });
}

export function useAvailabilityQuery() {
  return useQuery({
    queryKey: queryKeys.availability,
    queryFn: ({ signal }) => apiRequest<WireAvailabilityWindow[]>('/availability/windows', { signal }),
  });
}

export function useUnavailablePeriodsQuery() {
  return useQuery({
    queryKey: queryKeys.unavailablePeriods,
    queryFn: ({ signal }) => apiRequest<WireUnavailablePeriod[]>('/availability/unavailable-periods', { signal }),
  });
}

export function useSessionsQuery(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return useQuery({
    queryKey: [...queryKeys.schedule, from ?? null, to ?? null],
    queryFn: ({ signal }) => apiRequest<WireStudySession[]>(`/study-sessions${query ? `?${query}` : ''}`, { signal }),
  });
}

export function useTaskQuery(taskId: string) {
  return useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: ({ signal }) => apiRequest<WireAcademicTask>(`/tasks/${taskId}`, { signal }),
    enabled: Boolean(taskId),
  });
}

export function useProfileQuery() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: ({ signal }) => apiRequest<WireAccountProfile>('/account/profile', { signal }),
  });
}

export function usePreferencesQuery() {
  return useQuery({
    queryKey: queryKeys.preferences,
    queryFn: ({ signal }) => apiRequest<WireStudyPreferences>('/account/preferences', { signal }),
  });
}

export function useGoogleImportStatusQuery() {
  return useQuery({
    queryKey: queryKeys.googleImportStatus,
    queryFn: ({ signal }) => apiRequest<WireGoogleImportStatus>('/integrations/google/status', { signal }),
  });
}

export function useProgressQuery() {
  return useQuery({
    queryKey: queryKeys.progress,
    queryFn: ({ signal }) => apiRequest<WireEffortProgress[]>('/progress', { signal }),
  });
}

export function usePendingRevisionQuery() {
  return useQuery({
    queryKey: queryKeys.pendingRevision,
    queryFn: async ({ signal }) => {
      try {
        return await apiRequest<WireScheduleProposal>('/schedule-proposals/current', { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

export function useRecordOutcomeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, outcome, actualMinutes, remainingMinutes }: {
      sessionId: string;
      outcome: 'completed' | 'delayed' | 'missed';
      actualMinutes?: number;
      remainingMinutes?: number;
    }) => apiRequest(`/study-sessions/${sessionId}/outcomes`, {
      method: 'POST',
      body: JSON.stringify({
        outcome,
        ...(actualMinutes === undefined ? {} : { actual_minutes: actualMinutes }),
        ...(remainingMinutes === undefined ? {} : { remaining_minutes: remainingMinutes }),
      }),
    }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.schedule }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.progress }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingRevision }),
    ]),
  });
}

export function useProposalDecisionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, decision }: { proposalId: string; decision: 'accept' | 'reject' }) =>
      apiRequest(`/schedule-proposals/${proposalId}/${decision}`, { method: 'POST' }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.schedule }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.progress }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingRevision }),
    ]),
  });
}
