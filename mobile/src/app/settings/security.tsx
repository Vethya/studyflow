import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { apiRequest } from '../../lib/api-client';
import { SettingsPage } from './profile';

const passwordSchema = z.object({ currentPassword: z.string().optional(), newPassword: z.string().min(12, 'Use at least 12 characters') });
type PasswordValues = z.infer<typeof passwordSchema>;

export default function SecuritySettingsScreen() {
  const router = useRouter();
  const [identities, setIdentities] = useState<{ provider: string; email: string }[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '' } });

  useEffect(() => {
    apiRequest<{ provider: string; email: string }[]>('/account/identities').then(setIdentities).catch(() => undefined);
  }, []);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await apiRequest('/account/password', { method: 'PATCH', body: JSON.stringify({ current_password: values.currentPassword || null, new_password: values.newPassword }) });
      Alert.alert('Password updated', 'You may need to sign in again on other devices.');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not update password');
    }
  });

  return (
    <SettingsPage title="Security" onBack={() => router.back()}>
      <Text className="text-sm leading-5 text-muted">Change your StudyFlow password and review connected sign-in methods.</Text>
      <Text className="mb-2 mt-6 text-sm font-semibold text-ink">Connected accounts</Text>
      <View className="rounded-2xl border border-line bg-surface p-4">
        {identities.length ? identities.map((identity) => <Text key={`${identity.provider}-${identity.email}`} className="text-sm text-ink">{identity.provider} · {identity.email}</Text>) : <Text className="text-sm text-muted">No connected accounts.</Text>}
      </View>
      <PasswordField control={control} name="currentPassword" label="Current password" placeholder="Current password" />
      <PasswordField control={control} name="newPassword" label="New password" placeholder="At least 12 characters" />
      {serverError ? <Text className="mt-4 text-sm text-danger">{serverError}</Text> : null}
      <Pressable className="mt-6 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}>
        <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Updating…' : 'Update password'}</Text>
      </Pressable>
    </SettingsPage>
  );
}

function PasswordField({ control, name, label, placeholder }: { control: any; name: 'currentPassword' | 'newPassword'; label: string; placeholder: string }) {
  return <Controller control={control} name={name} render={({ field: { onBlur, onChange, value }, fieldState }) => <View className="mt-5"><Text className="mb-2 text-sm font-semibold text-ink">{label}</Text><TextInput value={value} onBlur={onBlur} onChangeText={onChange} secureTextEntry placeholder={placeholder} placeholderTextColor="#78818E" className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" />{fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}</View>} />;
}
