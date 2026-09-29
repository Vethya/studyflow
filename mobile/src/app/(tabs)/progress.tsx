import { useRouter } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';

import { AppHeader } from '../../components/app-header';
import { MetricCard } from '../../components/metric-card';
import { Screen } from '../../components/screen';
import { useProgressQuery, useSessionsQuery } from '../../features/queries';

export default function ProgressScreen() {
  const router = useRouter();
  const progressQuery = useProgressQuery();
  const sessionsQuery = useSessionsQuery();
  const progress = progressQuery.data ?? [];
  const history = (sessionsQuery.data ?? []).filter((session) => session.outcome).sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  const studyMinutes = progress.reduce((total, row) => total + row.actual_duration_minutes, 0);
  const remainingMinutes = progress.reduce((total, row) => total + row.estimated_remaining_minutes, 0);
  const completed = progress.reduce((total, row) => total + row.sessions_completed, 0);
  const upcoming = progress.reduce((total, row) => total + row.sessions_upcoming, 0);

  return (
    <Screen>
      <AppHeader title="Progress" subtitle="See how your consistency is building." onSearch={() => router.push('/search')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={progressQuery.isRefetching || sessionsQuery.isRefetching} onRefresh={() => { void Promise.all([progressQuery.refetch(), sessionsQuery.refetch()]); }} tintColor="#9BE15D" />}
      >
        {progressQuery.isPending ? <ActivityIndicator className="mt-12" color="#9BE15D" /> : null}
        <View className="flex-row flex-wrap gap-3">
          <MetricCard label="Tasks" value={`${progress.length}`} detail="tracked" />
          <MetricCard label="Worked" value={`${Math.floor(studyMinutes / 60)}h ${studyMinutes % 60}m`} detail="recorded" />
          <MetricCard label="Remaining" value={`${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m`} detail="estimated" />
          <MetricCard label="Sessions done" value={`${completed}`} detail="recorded" />
          <MetricCard label="Sessions to come" value={`${upcoming}`} detail="planned" />
        </View>
        <View className="mt-5 rounded-3xl border border-line bg-surface p-5">
          <Text className="text-lg font-bold text-ink">By task</Text>
          <Text className="mt-1 text-sm leading-5 text-muted">Effort is time worked against estimated time remaining.</Text>
          {progress.length ? progress.map((row) => (
            <View key={row.task_id} className="mt-5">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="font-semibold text-ink">{row.task_title}</Text>
                  <Text className="mt-1 text-xs capitalize text-muted">{row.status.replace('_', ' ')} · {row.actual_duration_minutes}m worked · {row.estimated_remaining_minutes}m left</Text>
                </View>
                <Text className="text-sm font-semibold text-accent">{row.effort_percent}%</Text>
              </View>
              <View className="mt-3 h-2 overflow-hidden rounded-full bg-line">
                <View className="h-full rounded-full bg-accent" style={{ width: `${Math.min(row.effort_percent, 100)}%` }} />
              </View>
            </View>
          )) : <Text className="mt-5 text-sm text-muted">No tasks yet. Add coursework to see progress.</Text>}
        </View>
        <View className="mt-5 rounded-3xl border border-line bg-surface p-5">
          <Text className="text-lg font-bold text-ink">Session history</Text>
          <Text className="mt-1 text-sm leading-5 text-muted">Every recorded study session, newest first.</Text>
          {history.length ? history.map((session) => (
            <View key={session.id} className="mt-5 border-l-2 border-line pl-4">
              <Text className="font-semibold capitalize text-ink">{session.outcome?.kind ?? 'recorded'}</Text>
              <Text className="mt-1 text-sm text-muted">{new Date(session.starts_at).toLocaleString()} · {session.planned_duration_minutes} min planned</Text>
            </View>
          )) : <Text className="mt-5 text-sm text-muted">Nothing recorded yet.</Text>}
        </View>
      </ScrollView>
    </Screen>
  );
}
