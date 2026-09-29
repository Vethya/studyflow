import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { queryKeys } from '@studyflow/api';

import { AppHeader } from '../../components/app-header';
import { Screen } from '../../components/screen';
import { useTasksQuery } from '../../features/queries';
import { apiRequest } from '../../lib/api-client';

export default function TasksScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tasksQuery = useTasksQuery();
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const filteredTasks = useMemo(() => tasks.filter((task) => (!category || task.category === category) && (!status || task.status === status)), [category, status, tasks]);

  return (
    <Screen>
      <AppHeader title="Tasks" subtitle="Everything you need to stay on track." onSearch={() => router.push('/search')} />
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-sm text-muted">{tasks.filter((task) => task.status !== 'completed').length} active tasks</Text>
        <View className="flex-row gap-2">
          <Pressable className="rounded-full bg-surface px-4 py-2 active:opacity-70" onPress={() => setFilterOpen(true)}>
            <Text className="font-semibold text-muted">Filter{category || status ? ' ·' : ''}</Text>
          </Pressable>
          <Pressable className="rounded-full bg-accent px-4 py-2 active:opacity-80" onPress={() => router.push('/task/new')}>
            <Text className="font-semibold text-canvas">+ Add</Text>
          </Pressable>
        </View>
      </View>
      {tasksQuery.isPending ? <ActivityIndicator className="mt-12" color="#9BE15D" /> : null}
      {tasksQuery.isError ? (
        <View className="mb-4 rounded-2xl border border-danger/40 bg-danger/10 p-4">
          <Text className="text-sm leading-5 text-danger">Could not load tasks. Check your connection and retry.</Text>
          <Pressable className="mt-3 self-start rounded-full bg-danger px-4 py-2" onPress={() => tasksQuery.refetch()}>
            <Text className="font-semibold text-canvas">Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {!tasksQuery.isPending && !tasksQuery.isError && tasks.length === 0 ? (
        <View className="rounded-3xl border border-line bg-surface p-6">
          <Text className="text-lg font-bold text-ink">No academic tasks yet</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">Add your coursework so StudyFlow can build a feasible plan.</Text>
          <Pressable className="mt-5 self-start rounded-full bg-accent px-4 py-3" onPress={() => router.push('/task/new')}>
            <Text className="font-semibold text-canvas">Add a task</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={filteredTasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={tasksQuery.isRefetching} onRefresh={() => tasksQuery.refetch()} tintColor="#9BE15D" />}
        renderItem={({ item }) => {
          const deleteTask = () => {
            Alert.alert('Delete task?', `This will remove “${item.title}”.`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await apiRequest<void>(`/tasks/${item.id}?confirmed=true`, { method: 'DELETE' });
                    await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
                  } catch (error) {
                    Alert.alert('Could not delete task', error instanceof Error ? error.message : 'Try again.');
                  }
                },
              },
            ]);
          };
          return (
            <Swipeable
              renderRightActions={() => (
                <Pressable className="mb-0 ml-3 w-24 items-center justify-center rounded-2xl bg-danger" onPress={deleteTask}>
                  <Text className="font-bold text-canvas">Delete</Text>
                </Pressable>
              )}
            >
              <Pressable className="rounded-2xl border border-line bg-surface p-4 active:opacity-80" onPress={() => router.push(`/task/${item.id}`)}>
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-ink">{item.title}</Text>
                    <Text className="mt-1 text-sm text-muted">{item.course ?? 'No course'}</Text>
                  </View>
                  <Text className="rounded-full bg-elevated px-3 py-1 text-xs text-muted">{item.status.replace('_', ' ')}</Text>
                </View>
                <Text className="mt-4 text-xs font-medium text-accent">
                  Due {new Date(item.deadline_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
              </Pressable>
            </Swipeable>
          );
        }}
      />
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <View className="flex-1 justify-end bg-black/50">
          <Pressable className="absolute inset-0" onPress={() => setFilterOpen(false)} />
          <View className="rounded-t-[32px] border-t border-line bg-surface px-5 pb-10 pt-4">
            <View className="mb-5 self-center h-1.5 w-12 rounded-full bg-line" />
            <Text className="text-2xl font-bold text-ink">Filter tasks</Text>
            <Text className="mb-3 mt-5 text-sm font-semibold text-ink">Category</Text>
            <View className="flex-row flex-wrap gap-2">
              {['assignment', 'reading', 'exam_preparation', 'project', 'research_writing', 'other'].map((value) => (
                <Pressable key={value} className={`rounded-full px-3 py-2 ${category === value ? 'bg-accent' : 'bg-elevated'}`} onPress={() => setCategory(category === value ? null : value)}>
                  <Text className={`text-xs font-semibold ${category === value ? 'text-canvas' : 'text-muted'}`}>{value.replace('_', ' ')}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="mb-3 mt-5 text-sm font-semibold text-ink">Status</Text>
            <View className="flex-row flex-wrap gap-2">
              {['not_started', 'in_progress', 'completed', 'overdue'].map((value) => (
                <Pressable key={value} className={`rounded-full px-3 py-2 ${status === value ? 'bg-accent' : 'bg-elevated'}`} onPress={() => setStatus(status === value ? null : value)}>
                  <Text className={`text-xs font-semibold ${status === value ? 'text-canvas' : 'text-muted'}`}>{value.replace('_', ' ')}</Text>
                </Pressable>
              ))}
            </View>
            <View className="mt-6 flex-row gap-3">
              <Pressable className="flex-1 items-center rounded-full border border-line py-3 active:opacity-70" onPress={() => { setCategory(null); setStatus(null); }}>
                <Text className="font-semibold text-muted">Reset</Text>
              </Pressable>
              <Pressable className="flex-1 items-center rounded-full bg-accent py-3 active:opacity-80" onPress={() => setFilterOpen(false)}>
                <Text className="font-semibold text-canvas">Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
