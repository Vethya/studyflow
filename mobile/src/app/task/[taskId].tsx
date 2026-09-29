import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { queryKeys } from '@studyflow/api';

import { useTaskQuery } from '../../features/queries';
import { apiRequest } from '../../lib/api-client';

export default function TaskDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const taskQuery = useTaskQuery(taskId);
  const task = taskQuery.data;

  const updateTask = async (path: string, body?: object) => {
    await apiRequest(`/tasks/${taskId}${path}`, {
      method: 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.schedule }),
      queryClient.invalidateQueries({ queryKey: queryKeys.progress }),
    ]);
  };

  const startTask = async () => {
    try {
      await updateTask('/start');
    } catch (error) {
      Alert.alert('Could not start task', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const finishEarly = () => {
    Alert.alert('Finish task early?', 'StudyFlow will stop planning time for this task.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish early',
        style: 'destructive',
        onPress: async () => {
          try {
            await updateTask('/finish-early', { confirmed: true });
          } catch (error) {
            Alert.alert('Could not finish task', error instanceof Error ? error.message : 'Try again.');
          }
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <View className="flex-row items-center justify-between">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70" onPress={() => router.back()}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <Pressable className="rounded-full bg-surface px-4 py-2 active:opacity-70" onPress={() => router.push(`/task/${taskId}/edit`)}>
          <Text className="font-semibold text-muted">Edit</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingTop: 28, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={taskQuery.isRefetching} onRefresh={() => taskQuery.refetch()} tintColor="#9BE15D" />}
      >
        {taskQuery.isPending ? <ActivityIndicator className="mt-12" color="#9BE15D" /> : null}
        {taskQuery.isError ? (
          <View className="rounded-3xl border border-danger/40 bg-danger/10 p-6">
            <Text className="text-base font-bold text-danger">Could not load this task.</Text>
            <Pressable className="mt-4 self-start rounded-full bg-danger px-4 py-3" onPress={() => taskQuery.refetch()}>
              <Text className="font-semibold text-canvas">Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {task ? (
          <>
            <Text className="text-xs font-semibold uppercase tracking-[2px] text-accent">Academic task</Text>
            <Text className="mt-3 text-3xl font-bold text-ink">{task.title}</Text>
            <Text className="mt-2 capitalize text-base text-muted">{task.category.replace('_', ' ')} · {task.status.replace('_', ' ')}</Text>
            <View className="mt-8 gap-3">
              {[
                ['Course', task.course ?? 'No course'],
                ['Due', new Date(task.deadline_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })],
                ['Estimate', `${task.planned_duration_minutes} minutes`],
                ['Priority', task.priority],
              ].map(([label, value]) => (
                <View key={label} className="rounded-2xl border border-line bg-surface p-4">
                  <Text className="text-xs font-medium text-muted">{label}</Text>
                  <Text className="mt-2 text-base font-semibold capitalize text-ink">{value}</Text>
                </View>
              ))}
            </View>
            {task.notes ? (
              <View className="mt-4 rounded-2xl border border-line bg-surface p-4">
                <Text className="text-xs font-medium text-muted">Notes</Text>
                <Text className="mt-2 text-sm leading-5 text-ink">{task.notes}</Text>
              </View>
            ) : null}
            {task.status === 'not_started' ? (
              <Pressable className="mt-6 items-center rounded-full bg-accent py-4 active:opacity-80" onPress={startTask}>
                <Text className="font-bold text-canvas">Start task</Text>
              </Pressable>
            ) : task.status === 'in_progress' ? (
              <Pressable className="mt-6 items-center rounded-full bg-accent py-4 active:opacity-80" onPress={finishEarly}>
                <Text className="font-bold text-canvas">Finish task early</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
