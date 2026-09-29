import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useTasksQuery } from '../features/queries';

export default function SearchPopup() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const tasksQuery = useTasksQuery(query);

  return (
    <View className="flex-1 items-center justify-center bg-black/60 px-5">
      <Pressable className="absolute inset-0" onPress={() => router.back()} />
      <View className="w-full rounded-3xl border border-line bg-surface p-5">
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="text-xl font-bold text-ink">Search StudyFlow</Text>
          <Pressable onPress={() => router.back()}>
            <Text className="text-sm font-semibold text-muted">Close</Text>
          </Pressable>
        </View>
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search tasks and courses"
          placeholderTextColor="#78818E"
          className="rounded-2xl border border-line bg-elevated px-4 py-4 text-base text-ink"
        />
        <Text className="mt-4 text-sm text-muted">Search tasks and courses.</Text>
        {tasksQuery.isPending && query.trim() ? <ActivityIndicator className="mt-6" color="#9BE15D" /> : null}
        {query.trim() && !tasksQuery.isPending ? (
          <ScrollView className="mt-4 max-h-72" contentContainerStyle={{ gap: 8 }}>
            {(tasksQuery.data ?? []).map((task) => (
              <Pressable key={task.id} className="rounded-2xl bg-elevated p-4 active:opacity-70" onPress={() => router.push(`/task/${task.id}`)}>
                <Text className="font-semibold text-ink">{task.title}</Text>
                <Text className="mt-1 text-sm text-muted">{task.course ?? 'No course'} · {task.status.replace('_', ' ')}</Text>
              </Pressable>
            ))}
            {!tasksQuery.data?.length ? <Text className="py-4 text-center text-sm text-muted">No matching tasks.</Text> : null}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}
