import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { queryKeys } from '@studyflow/api';

import { usePreferencesQuery } from '../../features/queries';
import { apiRequest } from '../../lib/api-client';
import { SettingsPage } from './profile';

const preferencesSchema = z.object({
  timezone: z.string().min(1, 'Enter a timezone'),
  sessionLength: z.number().int().min(10).max(240),
  breakMinutes: z.number().int().min(0).max(120),
});
type PreferencesValues = z.infer<typeof preferencesSchema>;

export default function PreferencesSettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const preferencesQuery = usePreferencesQuery();
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<PreferencesValues>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, sessionLength: 50, breakMinutes: 10 },
  });

  useEffect(() => {
    const preferences = preferencesQuery.data;
    if (preferences) reset({ timezone: preferences.timezone, sessionLength: preferences.preferred_session_length_minutes, breakMinutes: preferences.minimum_break_minutes });
  }, [preferencesQuery.data, reset]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await apiRequest('/account/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: values.timezone, preferred_session_length_minutes: values.sessionLength, minimum_break_minutes: values.breakMinutes }),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save preferences');
    }
  });

  return (
    <SettingsPage title="Preferences" onBack={() => router.back()}>
      <Text className="text-sm leading-5 text-muted">These values control how StudyFlow builds your schedule.</Text>
      <PreferenceField control={control} name="timezone" label="Timezone" placeholder="Asia/Phnom_Penh" />
      <PreferenceField control={control} name="sessionLength" label="Preferred session length" placeholder="50" keyboardType="number-pad" />
      <PreferenceField control={control} name="breakMinutes" label="Minimum break" placeholder="10" keyboardType="number-pad" />
      {serverError ? <Text className="mt-4 text-sm text-danger">{serverError}</Text> : null}
      <Pressable className="mt-6 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}>
        <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Saving…' : 'Save changes'}</Text>
      </Pressable>
    </SettingsPage>
  );
}

function PreferenceField({ control, name, label, placeholder, keyboardType }: { control: any; name: 'timezone' | 'sessionLength' | 'breakMinutes'; label: string; placeholder: string; keyboardType?: 'number-pad' }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onBlur, onChange, value }, fieldState }) => (
        <View className="mt-5">
          <Text className="mb-2 text-sm font-semibold text-ink">{label}</Text>
          <TextInput value={String(value ?? '')} onBlur={onBlur} onChangeText={(text) => onChange(keyboardType ? Number(text) : text)} keyboardType={keyboardType} placeholder={placeholder} placeholderTextColor="#78818E" className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" />
          {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
        </View>
      )}
    />
  );
}
