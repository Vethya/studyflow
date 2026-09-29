import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { queryKeys } from '@studyflow/api';

import { apiRequest } from '../../../lib/api-client';

const periodSchema = z.object({
  startsAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid start'),
  endsAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid end'),
  reason: z.string().max(200).optional(),
});
type PeriodValues = z.infer<typeof periodSchema>;

export default function NewUnavailablePeriodScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { weekday, periodId, startsAt, endsAt, reason: reasonParam } = useLocalSearchParams<{ weekday?: string; periodId?: string; startsAt?: string; endsAt?: string; reason?: string }>();
  const { control, handleSubmit, formState } = useForm<PeriodValues>({
    resolver: zodResolver(periodSchema),
    defaultValues: { startsAt: startsAt ?? nextWeekdayDate(Number(weekday ?? 0), 18), endsAt: endsAt ?? nextWeekdayDate(Number(weekday ?? 0), 21), reason: reasonParam ?? '' },
  });

  const submit = handleSubmit(async (values) => {
    await apiRequest(periodId && !Array.isArray(periodId) ? `/availability/unavailable-periods/${periodId}` : '/availability/unavailable-periods', {
      method: periodId && !Array.isArray(periodId) ? 'PUT' : 'POST',
      body: JSON.stringify({ starts_at: new Date(values.startsAt).toISOString(), ends_at: new Date(values.endsAt).toISOString(), reason: values.reason || null }),
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.unavailablePeriods });
    router.back();
  });

  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <View className="flex-row items-center gap-4">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70" onPress={() => router.back()}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <Text className="text-3xl font-bold text-ink">{periodId ? 'Edit blocked time' : 'Block time'}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 24, paddingBottom: 32 }}>
        <PeriodField control={control} name="startsAt" label="Starts" placeholder="2026-10-01T18:00:00+07:00" />
        <PeriodField control={control} name="endsAt" label="Ends" placeholder="2026-10-01T21:00:00+07:00" />
        <PeriodField control={control} name="reason" label="Reason" placeholder="Class, appointment, or rest" />
        <Pressable className="mt-6 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}>
          <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Saving…' : 'Block time'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function PeriodField({ control, name, label, placeholder }: { control: any; name: 'startsAt' | 'endsAt' | 'reason'; label: string; placeholder: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onBlur, onChange, value }, fieldState }) => (
        <View className="mb-5">
          <Text className="mb-2 text-sm font-semibold text-ink">{label}</Text>
          <TextInput value={value} onBlur={onBlur} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#78818E" className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" />
          {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
        </View>
      )}
    />
  );
}

function nextWeekdayDate(weekday: number, hour: number) {
  const date = new Date();
  const currentWeekday = (date.getDay() + 6) % 7;
  const distance = (weekday - currentWeekday + 7) % 7 || 7;
  date.setDate(date.getDate() + distance);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}
