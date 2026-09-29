import { Text, View } from 'react-native';

export function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <View className="min-w-[46%] flex-1 rounded-2xl border border-line bg-surface p-4">
      <Text className="text-xs font-medium text-muted">{label}</Text>
      <Text className="mt-3 text-xl font-bold text-ink">{value}</Text>
      <Text className="mt-1 text-xs text-muted">{detail}</Text>
    </View>
  );
}
