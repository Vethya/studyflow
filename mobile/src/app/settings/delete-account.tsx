import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { apiRequest } from '../../lib/api-client';
import { useAuth } from '../../providers/auth-provider';
import { SettingsPage } from './profile';

export default function DeleteAccountSettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const prepare = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const response = await apiRequest<{ challenge: string }>('/account/mobile/deletion/prepare', {
        method: 'POST',
        body: JSON.stringify({ current_password: password }),
      });
      setChallenge(response.challenge);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not verify your password');
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = () => {
    if (!challenge) return;
    Alert.alert('Delete account permanently?', 'This removes your profile, tasks, schedules, sessions, and connected data.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete account',
        style: 'destructive',
        onPress: async () => {
          setSubmitting(true);
          try {
            await apiRequest('/account/mobile/deletion/confirm', {
              method: 'POST',
              body: JSON.stringify({ challenge, confirmation: 'DELETE' }),
            });
            await signOut();
            router.replace('/auth');
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Could not delete your account');
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  };

  return (
    <SettingsPage title="Delete account" onBack={() => router.back()}>
      <View className="rounded-3xl border border-danger/40 bg-danger/10 p-5">
        <Text className="text-base font-bold text-danger">This cannot be undone.</Text>
        <Text className="mt-2 text-sm leading-5 text-danger">Your StudyFlow data will be permanently removed.</Text>
      </View>
      {!challenge ? (
        <>
          <Text className="mt-6 text-sm leading-5 text-muted">Enter your current password to prepare account deletion.</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Current password" placeholderTextColor="#78818E" className="mt-4 rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" />
          <Pressable className="mt-6 items-center rounded-full bg-danger py-4 active:opacity-80" disabled={!password || submitting} onPress={prepare}>
            <Text className="font-bold text-canvas">{submitting ? 'Checking…' : 'Continue'}</Text>
          </Pressable>
        </>
      ) : (
        <Pressable className="mt-6 items-center rounded-full bg-danger py-4 active:opacity-80" disabled={submitting} onPress={confirm}>
          <Text className="font-bold text-canvas">{submitting ? 'Deleting…' : 'Delete account'}</Text>
        </Pressable>
      )}
      {error ? <Text className="mt-4 text-sm leading-5 text-danger">{error}</Text> : null}
    </SettingsPage>
  );
}
