import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { apiRequest } from '../lib/api-client';

const schema = z.object({
  password: z.string().min(12, 'Use at least 12 characters'),
  confirmPassword: z.string().min(1, 'Confirm your password'),
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});
type Values = z.infer<typeof schema>;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const submit = handleSubmit(async ({ password }) => {
    if (!token || Array.isArray(token)) {
      setError('This reset link is missing its token.');
      return;
    }
    setError(null);
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      router.replace('/auth');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not reset your password');
    }
  });

  return (
    <View className="flex-1 justify-center bg-canvas px-6">
      <Text className="text-3xl font-bold text-ink">Choose a new password</Text>
      <Text className="mt-3 text-base leading-6 text-muted">Use at least 12 characters. You can sign in when this is complete.</Text>
      {(['password', 'confirmPassword'] as const).map((field) => (
        <Controller
          key={field}
          control={control}
          name={field}
          render={({ field: input, fieldState }) => (
            <View className="mt-5">
              <Text className="mb-2 text-sm font-semibold text-ink">{field === 'password' ? 'New password' : 'Confirm password'}</Text>
              <TextInput value={input.value} onBlur={input.onBlur} onChangeText={input.onChange} secureTextEntry placeholder="At least 12 characters" placeholderTextColor="#78818E" className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" />
              {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
            </View>
          )}
        />
      ))}
      {error ? <Text className="mt-5 text-sm leading-5 text-danger">{error}</Text> : null}
      <Pressable className="mt-7 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}>
        <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Saving…' : 'Reset password'}</Text>
      </Pressable>
    </View>
  );
}
