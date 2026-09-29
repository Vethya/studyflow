import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { apiRequest } from '../lib/api-client';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [signupToken, setSignupToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    if (!token || Array.isArray(token)) {
      setStatus('error');
      setError('This verification link is missing its token.');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const response = await apiRequest<{ signup_token: string }>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setSignupToken(response.signup_token);
      setStatus('ready');
    } catch (requestError) {
      setStatus('error');
      setError(requestError instanceof Error ? requestError.message : 'This link is invalid or expired.');
    }
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => void verify(), 0);
    return () => clearTimeout(timer);
  }, [verify]);

  return (
    <View className="flex-1 justify-center bg-canvas px-6">
      <Text className="text-3xl font-bold text-ink">Email verified</Text>
      {status === 'loading' ? <Text className="mt-3 text-base text-muted">Checking your link…</Text> : null}
      {status === 'ready' ? (
        <>
          <Text className="mt-3 text-base leading-6 text-muted">Your email is verified. Finish setting up your StudyFlow account.</Text>
          <Pressable
            className="mt-8 items-center rounded-full bg-accent py-4 active:opacity-80"
            onPress={() => router.replace({ pathname: '/complete-registration', params: { signupToken: signupToken ?? '' } })}
          >
            <Text className="font-bold text-canvas">Continue setup</Text>
          </Pressable>
        </>
      ) : null}
      {status === 'error' ? (
        <>
          <Text className="mt-3 text-base leading-6 text-danger">{error}</Text>
          <Pressable className="mt-8 items-center rounded-full bg-surface py-4 active:opacity-80" onPress={verify}>
            <Text className="font-bold text-ink">Try again</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
