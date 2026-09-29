import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { queryKeys } from '@studyflow/api';

import { useProfileQuery } from '../../features/queries';
import { apiRequest } from '../../lib/api-client';

const profileSchema = z.object({ name: z.string().trim().min(1, 'Enter your name').max(200) });
type ProfileValues = z.infer<typeof profileSchema>;

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profileQuery = useProfileQuery();
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    if (profileQuery.data) reset({ name: profileQuery.data.name });
  }, [profileQuery.data, reset]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await apiRequest('/account/profile', { method: 'PATCH', body: JSON.stringify(values) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save your profile');
    }
  });

  return (
    <SettingsPage title="Profile" onBack={() => router.back()}>
      <Text className="text-sm text-muted">{profileQuery.data?.email ?? 'Loading email…'}</Text>
      <Controller
        control={control}
        name="name"
        render={({ field: { onBlur, onChange, value }, fieldState }) => (
          <View className="mt-6">
            <Text className="mb-2 text-sm font-semibold text-ink">Name</Text>
            <TextInput value={value} onBlur={onBlur} onChangeText={onChange} className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" placeholder="Your name" placeholderTextColor="#78818E" />
            {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
          </View>
        )}
      />
      {serverError ? <Text className="mt-4 text-sm text-danger">{serverError}</Text> : null}
      <Pressable className="mt-6 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}>
        <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Saving…' : 'Save changes'}</Text>
      </Pressable>
    </SettingsPage>
  );
}

export function SettingsPage({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <View className="flex-row items-center gap-4">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70" onPress={onBack}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <Text className="text-3xl font-bold text-ink">{title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 24, paddingBottom: 32 }}>{children}</ScrollView>
    </View>
  );
}
