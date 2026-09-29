import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

type AppHeaderProps = {
  title: string;
  subtitle: string;
  onSearch: () => void;
};

export function AppHeader({ title, subtitle, onSearch }: AppHeaderProps) {
  const router = useRouter();

  return (
    <View className="mb-6 flex-row items-start justify-between gap-4">
      <View className="flex-1">
        <Text className="text-3xl font-bold tracking-tight text-ink">{title}</Text>
        <Text className="mt-2 text-sm leading-5 text-muted">{subtitle}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Pressable className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-70" onPress={onSearch}>
          <Text className="text-xl text-ink">⌕</Text>
        </Pressable>
        <Pressable
          className="h-11 w-11 items-center justify-center rounded-full bg-accent active:opacity-80"
          onPress={() => router.push('/account')}
          accessibilityLabel="Open account menu"
        >
          <Text className="font-bold text-canvas">S</Text>
        </Pressable>
      </View>
    </View>
  );
}
