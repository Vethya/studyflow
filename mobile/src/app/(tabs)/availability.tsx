import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { queryKeys } from '@studyflow/api';

import { AppHeader } from '../../components/app-header';
import { Screen } from '../../components/screen';
import { useAvailabilityQuery, useUnavailablePeriodsQuery } from '../../features/queries';
import { apiRequest } from '../../lib/api-client';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AvailabilityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedDay, setSelectedDay] = useState(() => (new Date().getDay() + 6) % 7);
  const availabilityQuery = useAvailabilityQuery();
  const unavailableQuery = useUnavailablePeriodsQuery();
  const selectedWindows = (availabilityQuery.data ?? []).filter((window) => window.weekday === selectedDay);
  const selectedPeriods = (unavailableQuery.data ?? []).filter((period) => (new Date(period.starts_at).getDay() + 6) % 7 === selectedDay);

  return (
    <Screen>
      <AppHeader title="Availability" subtitle="Tell StudyFlow when you can study." onSearch={() => router.push('/search')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={availabilityQuery.isRefetching || unavailableQuery.isRefetching} onRefresh={() => { void Promise.all([availabilityQuery.refetch(), unavailableQuery.refetch()]); }} tintColor="#9BE15D" />}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map((day, index) => (
            <Pressable
              key={day}
              className={`rounded-full px-4 py-3 ${index === selectedDay ? 'bg-accent' : 'bg-surface'}`}
              onPress={() => setSelectedDay(index)}
            >
              <Text className={`font-semibold ${index === selectedDay ? 'text-canvas' : 'text-muted'}`}>{day}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {availabilityQuery.isPending ? <ActivityIndicator className="mt-8" color="#9BE15D" /> : null}
        {availabilityQuery.isError ? (
          <View className="mt-6 rounded-2xl border border-danger/40 bg-danger/10 p-4">
            <Text className="text-sm leading-5 text-danger">Could not load availability. Pull to retry.</Text>
          </View>
        ) : null}
        <View className="mt-6 rounded-3xl border border-line bg-surface p-5">
          <Text className="text-lg font-bold text-ink">{days[selectedDay]}</Text>
          <Text className="mt-1 text-sm text-muted">Weekly study windows</Text>
          {selectedWindows.length === 0 ? (
            <Text className="mt-6 text-sm text-muted">No study windows for {days[selectedDay]}.</Text>
          ) : (
            selectedWindows.map((window) => {
              const removeWindow = () => {
                Alert.alert('Remove study window?', `${days[selectedDay]} ${window.start_time}–${window.end_time}`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await apiRequest('/availability/windows', {
                          method: 'PUT',
                          body: JSON.stringify({ windows: (availabilityQuery.data ?? []).filter((item) => item.id !== window.id).map((item) => ({ weekday: item.weekday, start_time: item.start_time, end_time: item.end_time })) }),
                        });
                        await queryClient.invalidateQueries({ queryKey: queryKeys.availability });
                      } catch (error) {
                        Alert.alert('Could not remove window', error instanceof Error ? error.message : 'Try again.');
                      }
                    },
                  },
                ]);
              };
              return (
                <Swipeable
                  key={window.id}
                  renderRightActions={() => <Pressable className="mt-6 ml-3 w-24 items-center justify-center rounded-2xl bg-danger" onPress={removeWindow}><Text className="font-bold text-canvas">Remove</Text></Pressable>}
                >
                  <Pressable className="mt-6 rounded-2xl bg-elevated p-4 active:opacity-80" onPress={() => router.push({ pathname: '/availability/edit', params: { windowId: window.id, weekday: String(window.weekday), start: window.start_time, end: window.end_time } })}>
                    <View className="flex-row justify-between">
                      <Text className="text-sm font-semibold text-ink">{window.start_time} – {window.end_time}</Text>
                      <Text className="text-sm text-accent">Free to study</Text>
                    </View>
                    <View className="mt-4 h-2 overflow-hidden rounded-full bg-line"><View className="h-full w-2/3 rounded-full bg-accent" /></View>
                  </Pressable>
                </Swipeable>
              );
            })
          )}
          <Pressable className="mt-5 items-center rounded-full border border-line py-3 active:opacity-70" onPress={() => router.push(`/availability/edit?weekday=${selectedDay}`)}>
            <Text className="font-semibold text-ink">+ Add window</Text>
          </Pressable>
        </View>
        <View className="mt-4 rounded-3xl border border-line bg-surface p-5">
          <Text className="text-lg font-bold text-ink">Unavailable periods</Text>
          {selectedPeriods.length === 0 ? <Text className="mt-2 text-sm text-muted">No unavailable periods for {days[selectedDay]}.</Text> : selectedPeriods.map((period) => {
            const removePeriod = () => Alert.alert('Remove unavailable period?', period.reason ?? 'This blocked period will be removed.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await apiRequest(`/availability/unavailable-periods/${period.id}?confirmed=true`, { method: 'DELETE' });
                    await queryClient.invalidateQueries({ queryKey: queryKeys.unavailablePeriods });
                  } catch (error) {
                    Alert.alert('Could not remove period', error instanceof Error ? error.message : 'Try again.');
                  }
                },
              },
            ]);
            return (
              <Swipeable key={period.id} renderRightActions={() => <Pressable className="mt-3 ml-3 w-24 items-center justify-center rounded-2xl bg-danger" onPress={removePeriod}><Text className="font-bold text-canvas">Remove</Text></Pressable>}>
                <Pressable className="mt-3 rounded-2xl bg-elevated p-4 active:opacity-80" onPress={() => router.push({ pathname: '/availability/unavailable/new', params: { periodId: period.id, startsAt: period.starts_at, endsAt: period.ends_at, reason: period.reason ?? '' } })}>
                  <Text className="text-sm font-semibold text-ink">{new Date(period.starts_at).toLocaleString()} – {new Date(period.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                  {period.reason ? <Text className="mt-1 text-sm text-muted">{period.reason}</Text> : null}
                </Pressable>
              </Swipeable>
            );
          })}
          <Pressable className="mt-5 items-center rounded-full border border-line py-3 active:opacity-70" onPress={() => router.push(`/availability/unavailable/new?weekday=${selectedDay}`)}>
            <Text className="font-semibold text-ink">+ Add unavailable period</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}
