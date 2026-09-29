import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { GoogleAccountLinkRequiredError, useAuth } from '../providers/auth-provider';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function AuthScreen() {
  const router = useRouter();
  const { completeGoogleLink, signIn, signInWithGoogle } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [googleChallenge, setGoogleChallenge] = useState<string | null>(null);
  const [googlePassword, setGooglePassword] = useState('');
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const { control, handleSubmit, formState } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await signIn(values.email, values.password);
      router.replace('/(tabs)');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Unable to sign in');
    }
  });

  const signInGoogle = async () => {
    setServerError(null);
    try {
      await signInWithGoogle();
      router.replace('/(tabs)');
    } catch (error) {
      if (error instanceof GoogleAccountLinkRequiredError) {
        setGoogleChallenge(error.challenge);
        return;
      }
      setServerError(error instanceof Error ? error.message : 'Unable to sign in with Google');
    }
  };

  const linkGoogle = async () => {
    if (!googleChallenge || !googlePassword) return;
    setGoogleSubmitting(true);
    setServerError(null);
    try {
      await completeGoogleLink(googleChallenge, googlePassword);
      router.replace('/(tabs)');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Unable to link Google');
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View>
          <View className="mb-10 h-14 w-14 items-center justify-center rounded-2xl bg-accent">
            <Text className="text-2xl font-black text-canvas">S</Text>
          </View>
          <Text className="text-4xl font-bold text-ink">Welcome back</Text>
          <Text className="mt-3 text-base leading-6 text-muted">Sign in to continue planning study time that fits your week.</Text>

          {googleChallenge ? (
            <View className="mt-8 rounded-2xl border border-line bg-surface p-4">
              <Text className="text-base font-bold text-ink">Confirm account linking</Text>
              <Text className="mt-2 text-sm leading-5 text-muted">Enter your StudyFlow password to connect this Google account.</Text>
              <TextInput
                autoComplete="password"
                className="mt-4 rounded-2xl border border-line bg-canvas px-4 py-4 text-base text-ink"
                onChangeText={setGooglePassword}
                placeholder="Your password"
                placeholderTextColor="#78818E"
                secureTextEntry
                value={googlePassword}
              />
              <Pressable
                className="mt-4 items-center rounded-full bg-accent py-4 active:opacity-80"
                disabled={googleSubmitting || !googlePassword}
                onPress={linkGoogle}
              >
                <Text className="font-bold text-canvas">{googleSubmitting ? 'Linking…' : 'Link Google account'}</Text>
              </Pressable>
            </View>
          ) : null}

          {serverError ? (
            <View className="mt-6 rounded-2xl border border-danger/40 bg-danger/10 p-4">
              <Text className="text-sm leading-5 text-danger">{serverError}</Text>
            </View>
          ) : null}

          <View className="mt-8 gap-5">
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value }, fieldState }) => (
                <View>
                  <Text className="mb-2 text-sm font-semibold text-ink">Email</Text>
                  <TextInput
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    placeholder="you@example.com"
                    placeholderTextColor="#78818E"
                    value={value}
                    className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink"
                  />
                  {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
                </View>
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value }, fieldState }) => (
                <View>
                  <Text className="mb-2 text-sm font-semibold text-ink">Password</Text>
                  <TextInput
                    autoComplete="password"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    placeholder="Your password"
                    placeholderTextColor="#78818E"
                    secureTextEntry
                    value={value}
                    className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink"
                  />
                  {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
                </View>
              )}
            />
          </View>

          <Pressable
            className="mt-6 items-center rounded-full border border-line bg-surface py-4 active:opacity-70"
            onPress={signInGoogle}
          >
            <Text className="font-bold text-ink">Continue with Google</Text>
          </Pressable>

          <Pressable
            className="mt-8 items-center rounded-full bg-accent py-4 active:opacity-80"
            disabled={formState.isSubmitting}
            onPress={submit}
          >
            <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Signing in…' : 'Sign in'}</Text>
          </Pressable>
          <Pressable className="mt-5 items-center py-3 active:opacity-70" onPress={() => router.push('/forgot-password')}>
            <Text className="font-semibold text-muted">Forgot password?</Text>
          </Pressable>
          <Pressable className="items-center py-3 active:opacity-70" onPress={() => router.push('/register')}>
            <Text className="font-semibold text-accent">Create an account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
