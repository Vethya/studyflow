import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { AppHeader } from '../../components/app-header';
import { Screen } from '../../components/screen';
import { useSessionsQuery } from '../../features/queries';

export default function CalendarScreen() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const range = useMemo(() => {
    const from = new Date(selectedDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [selectedDate]);
  const sessionsQuery = useSessionsQuery(range.from, range.to);
  const sessions = sessionsQuery.data ?? [];
  const isToday = new Date().toDateString() === selectedDate.toDateString();
  const moveDay = (amount: number) => {
    setSelectedDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + amount);
      return next;
    });
  };
  const changeDate = (event: DateTimePickerEvent, date?: Date) => {
    setShowDatePicker(false);
    if (event.type !== 'dismissed' && date) setSelectedDate(date);
  };

  return (
    <Screen>
      <AppHeader title="Calendar" subtitle="Your plan, one day at a time." onSearch={() => router.push('/search')} />
      <View className="mb-5 flex-row items-center justify-between rounded-2xl border border-line bg-surface p-4">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-elevated active:opacity-70" onPress={() => moveDay(-1)}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <View className="items-center">
          <Pressable className="rounded-xl px-3 py-1 active:opacity-70" onPress={() => setShowDatePicker(true)}>
            <Text className="text-base font-bold text-ink">
              {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            </Text>
          </Pressable>
          <Text className="mt-1 text-xs text-muted">{isToday ? 'Today' : selectedDate.toLocaleDateString(undefined, { year: 'numeric' })}</Text>
        </View>
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-elevated active:opacity-70" onPress={() => moveDay(1)}>
          <Text className="text-xl text-ink">›</Text>
        </Pressable>
      </View>
      {showDatePicker ? (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={changeDate}
        />
      ) : null}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={sessionsQuery.isRefetching} onRefresh={() => sessionsQuery.refetch()} tintColor="#9BE15D" />}
      >
        {sessionsQuery.isPending ? <ActivityIndicator className="mt-12" color="#9BE15D" /> : null}
        {!sessionsQuery.isPending && sessions.length === 0 ? (
          <View className="rounded-3xl border border-line bg-surface p-6">
            <Text className="text-lg font-bold text-ink">Nothing scheduled yet</Text>
            <Text className="mt-2 text-sm leading-5 text-muted">Add tasks and availability so StudyFlow can build your first plan.</Text>
          </View>
        ) : null}
        <View className="gap-3">
          {sessions.map((session) => (
            <Pressable key={session.id} className="flex-row rounded-2xl border border-line bg-surface p-4 active:opacity-80" onPress={() => router.push(`/session-outcome?sessionId=${session.id}`)}>
              <Text className="w-20 pt-1 text-xs font-semibold text-accent">{new Date(session.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
              <View className="flex-1 border-l-2 border-line pl-4">
                <Text className="font-semibold text-ink">Study session</Text>
                <Text className="mt-1 text-sm text-muted">{session.planned_duration_minutes} min · Task {session.task_id}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
