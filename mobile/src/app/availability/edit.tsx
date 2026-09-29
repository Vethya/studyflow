import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { queryKeys } from '@studyflow/api';

import { useAvailabilityQuery } from '../../features/queries';
import { apiRequest } from '../../lib/api-client';

const windowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
});

export default function EditAvailabilityScreen() {
  const router = useRouter();
  const { weekday: weekdayParam, windowId, start, end } = useLocalSearchParams<{ weekday?: string; windowId?: string; start?: string; end?: string }>();
  const queryClient = useQueryClient();
  const existing = useAvailabilityQuery();
  const { control, handleSubmit, formState } = useForm({
    resolver: zodResolver(windowSchema),
    defaultValues: { weekday: weekdayParam ? Number(weekdayParam) : 0, start: start ?? '18:00', end: end ?? '21:00' },
  });
  const submit = handleSubmit(async (values) => {
    const windows = [
      ...(existing.data ?? []).map((window) => ({ weekday: window.weekday, start_time: window.start_time, end_time: window.end_time })),
      { weekday: values.weekday, start_time: values.start, end_time: values.end },
    ];
    if (windowId && !Array.isArray(windowId)) {
      windows.splice(0, windows.length, ...(existing.data ?? []).map((window) => window.id === windowId ? { weekday: values.weekday, start_time: values.start, end_time: values.end } : { weekday: window.weekday, start_time: window.start_time, end_time: window.end_time }));
    }
    await apiRequest('/availability/windows', { method: 'PUT', body: JSON.stringify({ windows }) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.availability });
    router.back();
  });

  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <View className="flex-row items-center gap-4">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface" onPress={() => router.back()}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <Text className="text-3xl font-bold text-ink">{windowId ? 'Edit window' : 'Add window'}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 24, paddingBottom: 32 }}>
        <WindowField control={control} name="weekday" label="Weekday (0 = Monday)" placeholder="0" />
        <WindowField control={control} name="start" label="Start time" placeholder="18:00" />
        <WindowField control={control} name="end" label="End time" placeholder="21:00" />
        <Pressable className="mt-4 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}>
          <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Saving…' : 'Save window'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function WindowField({ control, name, label, placeholder }: { control: any; name: 'weekday' | 'start' | 'end'; label: string; placeholder: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState }) => (
        <View className="mb-5">
          <Text className="mb-2 text-sm font-semibold text-ink">{label}</Text>
          <TextInput value={String(value ?? '')} onBlur={onBlur} onChangeText={(text) => onChange(name === 'weekday' ? Number(text) : text)} placeholder={placeholder} placeholderTextColor="#78818E" keyboardType={name === 'weekday' ? 'number-pad' : 'default'} className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" />
          {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
        </View>
      )}
    />
  );
}
