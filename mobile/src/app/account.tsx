import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '../providers/auth-provider';

export default function AccountSheet() {
  const router = useRouter();
  const { session, signOut } = useAuth();

  return (
    <View className="flex-1 justify-end bg-black/50">
      <Pressable className="absolute inset-0" onPress={() => router.back()} />
      <View className="rounded-t-[32px] border-t border-line bg-surface px-5 pb-10 pt-3">
        <View className="mb-5 self-center h-1.5 w-12 rounded-full bg-line" />
        <View className="mb-5 flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-accent">
            <Text className="text-lg font-bold text-canvas">S</Text>
          </View>
          <View>
            <Text className="text-base font-bold text-ink">{session?.account.name ?? 'StudyFlow user'}</Text>
            <Text className="mt-1 text-sm text-muted">{session?.account.email ?? ''}</Text>
          </View>
        </View>
        {[
          ['Appearance', '/settings/appearance'],
          ['Settings', '/settings'],
          ['Onboarding', '/onboarding'],
          ['Schedule revisions', '/schedule-revisions'],
          ['Google imports', '/import/google'],
        ].map(([item, href]) => (
          <Pressable key={item} className="border-t border-line py-4 active:opacity-70" onPress={() => router.push(href as never)}>
            <Text className="text-base font-medium text-ink">{item}</Text>
          </Pressable>
        ))}
        <Pressable
          className="border-t border-line py-4 active:opacity-70"
          onPress={async () => {
            await signOut();
            router.replace('/auth');
          }}
        >
          <Text className="text-base font-medium text-danger">Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}
