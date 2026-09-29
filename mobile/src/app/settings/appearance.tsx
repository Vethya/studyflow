import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useTheme, type ThemePreference } from '../../providers/theme-provider';
import { SettingsPage } from './profile';

const choices = ['system', 'light', 'dark'] as const;

export default function AppearanceSettingsScreen() {
  const router = useRouter();
  const { preference, setPreference } = useTheme();

  return (
    <SettingsPage title="Appearance" onBack={() => router.back()}>
      <Text className="text-sm leading-5 text-muted">Choose the visual preference used by the mobile app.</Text>
      <View className="mt-6 overflow-hidden rounded-3xl border border-line bg-surface">
        {choices.map((choice, index) => (
            <Pressable key={choice} className={`p-5 active:opacity-70 ${index ? 'border-t border-line' : ''}`} onPress={() => setPreference(choice as ThemePreference)}>
              <View className="flex-row items-center justify-between">
                <Text className="text-base font-semibold capitalize text-ink">{choice}</Text>
                <Text className="text-accent">{preference === choice ? 'Selected' : ''}</Text>
              </View>
          </Pressable>
        ))}
      </View>
      <Text className="mt-4 text-xs leading-5 text-muted">The app follows the system appearance by default. Choose a fixed theme when you want StudyFlow to stay light or dark.</Text>
    </SettingsPage>
  );
}
