import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { AppHeader } from '../../components/app-header';
import { MetricCard } from '../../components/metric-card';
import { Screen } from '../../components/screen';
import { useProgressQuery, useSessionsQuery, useTasksQuery } from '../../features/queries';

export default function DashboardScreen() {
  const router = useRouter();
  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const sessionsQuery = useSessionsQuery(range.from, range.to);
  const tasksQuery = useTasksQuery();
  const progressQuery = useProgressQuery();
  const sessions = sessionsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const nextSession = sessions.find((session) => new Date(session.starts_at) > new Date()) ?? sessions[0];
  const plannedMinutes = sessions.reduce((total, session) => total + session.planned_duration_minutes, 0);
  const completedSessions = (progressQuery.data ?? []).reduce((total, row) => total + row.sessions_completed, 0);
  const activeTasks = tasks.filter((task) => task.status !== 'completed').length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const refresh = () => Promise.all([sessionsQuery.refetch(), tasksQuery.refetch(), progressQuery.refetch()]);

  return (
    <Screen>
      <AppHeader title={greeting} subtitle="Here is your study plan for today." onSearch={() => router.push('/search')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={sessionsQuery.isRefetching || tasksQuery.isRefetching || progressQuery.isRefetching} onRefresh={refresh} tintColor="#9BE15D" />}
      >
        {sessionsQuery.isPending ? <ActivityIndicator className="mt-12" color="#9BE15D" /> : null}
        {sessionsQuery.isError ? (
          <View className="mb-5 rounded-2xl border border-danger/40 bg-danger/10 p-4">
            <Text className="text-sm leading-5 text-danger">Could not load today’s plan.</Text>
            <Pressable className="mt-3 self-start rounded-full bg-danger px-4 py-2" onPress={refresh}><Text className="font-semibold text-canvas">Retry</Text></Pressable>
          </View>
        ) : null}
        <View className="mb-5 rounded-3xl border border-line bg-surface p-5">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-[2px] text-accent">Next session</Text>
          {nextSession ? (
            <>
              <Text className="text-2xl font-bold text-ink">{tasks.find((task) => task.id === nextSession.task_id)?.title ?? 'Study session'}</Text>
              <Text className="mt-2 text-sm text-muted">{new Date(nextSession.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {nextSession.planned_duration_minutes} minutes</Text>
              <Pressable className="mt-5 self-start rounded-full bg-accent px-5 py-3 active:opacity-80" onPress={() => router.push('/calendar')}>
                <Text className="font-semibold text-canvas">Open calendar</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text className="text-xl font-bold text-ink">Nothing scheduled yet</Text>
              <Text className="mt-2 text-sm leading-5 text-muted">Add tasks and availability so StudyFlow can build your first plan.</Text>
              <Pressable className="mt-5 self-start rounded-full bg-accent px-5 py-3 active:opacity-80" onPress={() => router.push('/task/new')}>
                <Text className="font-semibold text-canvas">Add a task</Text>
              </Pressable>
            </>
          )}
        </View>

        <View className="mb-5 flex-row flex-wrap gap-3">
          <MetricCard label="Today" value={Math.floor(plannedMinutes / 60) + 'h ' + (plannedMinutes % 60) + 'm'} detail="planned" />
          <MetricCard label="Tasks" value={String(activeTasks)} detail="active" />
          <MetricCard label="Sessions" value={String(completedSessions)} detail="completed" />
          <MetricCard label="Progress" value={String(progressQuery.data?.length ?? 0)} detail="tracked" />
        </View>

        <View className="rounded-3xl border border-line bg-surface p-5">
          <Text className="text-lg font-bold text-ink">Today’s plan</Text>
          <Text className="mt-1 text-sm text-muted">Your upcoming sessions in order.</Text>
          {sessions.length ? sessions.map((session) => (
            <Pressable key={session.id} className="mt-5 border-l-2 border-accent pl-4 active:opacity-70" onPress={() => router.push('/calendar')}>
              <Text className="font-semibold text-ink">{tasks.find((task) => task.id === session.task_id)?.title ?? 'Study session'}</Text>
              <Text className="mt-1 text-sm text-muted">{new Date(session.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {session.planned_duration_minutes} min</Text>
            </Pressable>
          )) : <Text className="mt-5 text-sm text-muted">Your plan is clear for today.</Text>}
        </View>
      </ScrollView>
    </Screen>
  );
}
