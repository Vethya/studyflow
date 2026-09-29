import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { apiRequest } from '../lib/api-client';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  password: z.string().min(12, 'Use at least 12 characters'),
  confirmPassword: z.string().min(1, 'Confirm your password'),
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});
type Values = z.infer<typeof schema>;

export default function CompleteRegistrationScreen() {
  const router = useRouter();
  const { signupToken } = useLocalSearchParams<{ signupToken?: string }>();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', password: '', confirmPassword: '' },
  });
  const submit = handleSubmit(async ({ name, password }) => {
    if (!signupToken || Array.isArray(signupToken)) {
      setError('This signup link is missing its token.');
      return;
    }
    setError(null);
    try {
      await apiRequest('/auth/complete-registration', {
        method: 'POST',
        body: JSON.stringify({
          signup_token: signupToken,
          name,
          password,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      router.replace('/auth');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not complete registration');
    }
  });

  return (
    <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text className="text-3xl font-bold text-ink">Finish your account</Text>
        <Text className="mt-3 text-base leading-6 text-muted">Add your name and choose a password to start using StudyFlow.</Text>
        {(['name', 'password', 'confirmPassword'] as const).map((field) => (
          <Controller
            key={field}
            control={control}
            name={field}
            render={({ field: input, fieldState }) => (
              <View className="mt-5">
                <Text className="mb-2 text-sm font-semibold text-ink">{field === 'confirmPassword' ? 'Confirm password' : field === 'password' ? 'Password' : 'Name'}</Text>
                <TextInput
                  autoCapitalize={field === 'name' ? 'words' : 'none'}
                  onBlur={input.onBlur}
                  onChangeText={input.onChange}
                  placeholder={field === 'name' ? 'Your name' : 'At least 12 characters'}
                  placeholderTextColor="#78818E"
                  secureTextEntry={field !== 'name'}
                  value={input.value}
                  className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink"
                />
                {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
              </View>
            )}
          />
        ))}
        {error ? <Text className="mt-5 text-sm leading-5 text-danger">{error}</Text> : null}
        <Pressable className="mt-7 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}>
          <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Saving…' : 'Complete setup'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
