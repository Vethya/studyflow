import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { apiRequest } from '../lib/api-client';

const schema = z.object({ email: z.string().email('Enter a valid email address') });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await apiRequest('/auth/forgot-password', { method: 'POST', body: JSON.stringify(values) });
      setMessage('If the address is eligible, a password reset email has been sent.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not request a reset');
    }
  });

  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70" onPress={() => router.back()}><Text className="text-xl text-ink">‹</Text></Pressable>
      <Text className="mt-10 text-3xl font-bold text-ink">Reset password</Text>
      <Text className="mt-3 text-base leading-6 text-muted">Enter your email and we’ll send instructions if the account exists.</Text>
      <Controller control={control} name="email" render={({ field: { onBlur, onChange, value }, fieldState }) => <View className="mt-8"><Text className="mb-2 text-sm font-semibold text-ink">Email</Text><TextInput value={value} onBlur={onBlur} onChangeText={onChange} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor="#78818E" className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" />{fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}</View>} />
      {message ? <Text className="mt-5 text-sm leading-5 text-accent">{message}</Text> : null}
      {error ? <Text className="mt-5 text-sm leading-5 text-danger">{error}</Text> : null}
      <Pressable className="mt-6 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}><Text className="font-bold text-canvas">{formState.isSubmitting ? 'Sending…' : 'Send reset email'}</Text></Pressable>
    </View>
  );
}
