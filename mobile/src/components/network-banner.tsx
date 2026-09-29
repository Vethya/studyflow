import { useNetInfo } from '@react-native-community/netinfo';
import { Text, View } from 'react-native';

export function NetworkBanner() {
  const { isConnected } = useNetInfo();
  if (isConnected !== false) return null;
  return (
    <View className="absolute left-4 right-4 top-3 z-50 rounded-2xl border border-line bg-elevated px-4 py-3">
      <Text className="text-center text-sm font-semibold text-ink">You’re offline</Text>
      <Text className="mt-1 text-center text-xs text-muted">Showing saved data. Changes need a connection.</Text>
    </View>
  );
}
