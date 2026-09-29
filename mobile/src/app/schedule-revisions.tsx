import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { usePendingRevisionQuery, useProposalDecisionMutation } from '../features/queries';

export default function ScheduleRevisionsScreen() {
  const router = useRouter();
  const revisionQuery = usePendingRevisionQuery();
  const decision = useProposalDecisionMutation();
  const revision = revisionQuery.data;

  const decide = async (value: 'accept' | 'reject') => {
    if (!revision) return;
    await decision.mutateAsync({ proposalId: revision.id, decision: value });
    router.back();
  };

  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <View className="flex-row items-center gap-4">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface" onPress={() => router.back()}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <Text className="text-3xl font-bold text-ink">Revisions</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 24, paddingBottom: 32 }}>
        {revisionQuery.isPending ? <ActivityIndicator className="mt-12" color="#9BE15D" /> : null}
        {revisionQuery.isError ? (
          <View className="rounded-2xl border border-danger/40 bg-danger/10 p-4">
            <Text className="text-sm leading-5 text-danger">Could not load schedule revisions.</Text>
            <Pressable className="mt-3 self-start rounded-full bg-danger px-4 py-2" onPress={() => revisionQuery.refetch()}>
              <Text className="font-semibold text-canvas">Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {!revisionQuery.isPending && !revisionQuery.isError && !revision ? (
          <View className="rounded-3xl border border-line bg-surface p-6">
            <Text className="text-lg font-bold text-ink">No pending revisions</Text>
            <Text className="mt-2 text-sm leading-5 text-muted">Your accepted study plan is up to date.</Text>
          </View>
        ) : null}
        {revision ? (
          <View className="rounded-3xl border border-line bg-surface p-5">
            <Text className="text-xs font-semibold uppercase tracking-[2px] text-accent">Pending review</Text>
            <Text className="mt-3 text-xl font-bold text-ink">A new plan is ready</Text>
            <Text className="mt-2 text-sm leading-5 text-muted">{revision.revision_reason ?? 'StudyFlow adjusted your upcoming sessions.'}</Text>
            <View className="mt-6 gap-3">
              {revision.sessions.map((session) => (
                <View key={session.id} className="rounded-2xl bg-elevated p-4">
                  <Text className="text-sm font-semibold text-ink">{session.task_title ?? 'Study session'}</Text>
                  <Text className="mt-1 text-sm text-muted">{new Date(session.starts_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {session.planned_duration_minutes} min</Text>
                </View>
              ))}
              {revision.unscheduled_work.map((work) => (
                <View key={work.task_id} className="rounded-2xl border border-danger/40 bg-danger/10 p-4">
                  <Text className="text-sm font-semibold text-danger">{work.task_title ?? 'Unscheduled work'}</Text>
                  <Text className="mt-1 text-sm text-danger">{work.unscheduled_minutes} minutes could not fit.</Text>
                </View>
              ))}
            </View>
            {decision.isError ? <Text className="mt-4 text-sm text-danger">{decision.error.message}</Text> : null}
            <View className="mt-6 flex-row gap-3">
              <Pressable className="flex-1 items-center rounded-full border border-line py-3 active:opacity-70" disabled={decision.isPending} onPress={() => decide('reject')}>
                <Text className="font-semibold text-muted">Reject</Text>
              </Pressable>
              <Pressable className="flex-1 items-center rounded-full bg-accent py-3 active:opacity-80" disabled={decision.isPending} onPress={() => decide('accept')}>
                <Text className="font-semibold text-canvas">{decision.isPending ? 'Saving…' : 'Accept plan'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
