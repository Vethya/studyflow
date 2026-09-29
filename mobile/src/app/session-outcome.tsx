import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useRecordOutcomeMutation, useSessionsQuery } from '../features/queries';

type Outcome = 'completed' | 'delayed' | 'missed';

export default function SessionOutcomeSheet() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const sessionsQuery = useSessionsQuery();
  const recordOutcome = useRecordOutcomeMutation();
  const session = sessionsQuery.data?.find((item) => item.id === sessionId);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [actualMinutes, setActualMinutes] = useState('');
  const [remainingMinutes, setRemainingMinutes] = useState('');
  const canSubmit = Boolean(
    sessionId &&
      outcome &&
      (outcome === 'missed' || Number(actualMinutes) > 0) &&
      (!remainingMinutes || Number(remainingMinutes) > 0),
  );

  const submit = async () => {
    if (!sessionId || !outcome || !canSubmit) return;
    await recordOutcome.mutateAsync({
      sessionId,
      outcome,
      ...(outcome === 'missed' ? {} : { actualMinutes: Number(actualMinutes) }),
      ...(outcome === 'delayed' && remainingMinutes ? { remainingMinutes: Number(remainingMinutes) } : {}),
    });
    router.back();
  };

  return (
    <View className="flex-1 justify-end bg-black/50">
      <View className="rounded-t-[32px] border-t border-line bg-surface px-5 pb-10 pt-4">
        <View className="mb-5 self-center h-1.5 w-12 rounded-full bg-line" />
        <Text className="text-2xl font-bold text-ink">How did it go?</Text>
        <Text className="mt-2 text-sm text-muted">
          {session ? `${session.planned_duration_minutes} minutes planned` : 'Choose an outcome for this session.'}
        </Text>
        {sessionsQuery.isError ? <Text className="mt-4 text-sm text-danger">Could not load this session. Try again.</Text> : null}
        {!sessionId ? <Text className="mt-4 text-sm text-muted">Open this sheet from a calendar session.</Text> : null}
        <View className="mt-6 gap-3">
          {(['completed', 'delayed', 'missed'] as const).map((value) => (
            <Pressable
              key={value}
              className={`rounded-2xl border p-4 active:opacity-70 ${outcome === value ? 'border-accent bg-accent/10' : 'border-line bg-elevated'}`}
              onPress={() => setOutcome(value)}
            >
              <Text className="text-base font-semibold capitalize text-ink">{value}</Text>
            </Pressable>
          ))}
        </View>
        {outcome && outcome !== 'missed' ? (
          <View className="mt-5 gap-3">
            <TextInput
              value={actualMinutes}
              onChangeText={setActualMinutes}
              placeholder="Actual minutes"
              placeholderTextColor="#78818E"
              keyboardType="number-pad"
              className="rounded-2xl border border-line bg-elevated px-4 py-4 text-base text-ink"
            />
            {outcome === 'delayed' ? (
              <TextInput
                value={remainingMinutes}
                onChangeText={setRemainingMinutes}
                placeholder="Remaining minutes (optional)"
                placeholderTextColor="#78818E"
                keyboardType="number-pad"
                className="rounded-2xl border border-line bg-elevated px-4 py-4 text-base text-ink"
              />
            ) : null}
          </View>
        ) : null}
        {recordOutcome.isError ? <Text className="mt-4 text-sm leading-5 text-danger">{recordOutcome.error.message}. Your session was not changed.</Text> : null}
        <Pressable
          className={`mt-6 items-center rounded-full py-4 ${canSubmit ? 'bg-accent active:opacity-80' : 'bg-line'}`}
          disabled={!canSubmit || recordOutcome.isPending}
          onPress={submit}
        >
          <Text className={`font-bold ${canSubmit ? 'text-canvas' : 'text-muted'}`}>{recordOutcome.isPending ? 'Saving…' : 'Save outcome'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
