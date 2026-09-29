import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

const settings = [
  ['Profile', 'Name, email, and avatar', '/settings/profile'],
  ['Security', 'Password and sign-in methods', '/settings/security'],
  ['Preferences', 'Timezone, session length, and breaks', '/settings/preferences'],
  ['Appearance', 'Theme and motion preferences', '/settings/appearance'],
  ['Google connections', 'Calendar and Classroom access', '/import/google'],
  ['Delete account', 'Permanently remove your StudyFlow data', '/settings/delete-account'],
] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => settings.filter(([title, description]) => `${title} ${description}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <View className="flex-row items-center gap-4">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface" onPress={() => router.back()}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <Text className="text-3xl font-bold text-ink">Settings</Text>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Filter settings"
        placeholderTextColor="#78818E"
        className="mt-6 rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink"
        accessibilityLabel="Filter settings"
      />
      <ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: 32 }}>
        <View className="overflow-hidden rounded-3xl border border-line bg-surface">
          {filtered.map(([title, description, href], index) => (
            <Pressable key={title} className={`p-5 active:opacity-70 ${index ? 'border-t border-line' : ''}`} onPress={() => router.push(href as never)}>
              <Text className={`text-base font-semibold ${title === 'Delete account' ? 'text-danger' : 'text-ink'}`}>{title}</Text>
              <Text className="mt-1 text-sm text-muted">{description}</Text>
            </Pressable>
          ))}
        </View>
        {filtered.length === 0 ? <Text className="mt-8 text-center text-sm text-muted">No settings match “{query}”.</Text> : null}
      </ScrollView>
    </View>
  );
}
