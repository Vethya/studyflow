import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { completeOnboarding } from '../lib/onboarding-storage';

const steps = [
  ['Set the hours you can study', 'Your weekly windows are the time StudyFlow plans inside.'],
  ['Add your academic tasks', 'Bring in the coursework, deadlines, and estimates that matter.'],
  ['Review your first plan', 'StudyFlow fits your work into the time you actually have.'],
  ['Make progress your own', 'Record outcomes so future estimates become more useful.'],
] as const;

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const current = steps[step];
  const finish = async () => {
    await completeOnboarding();
    router.replace('/(tabs)');
  };

  return (
    <View className="flex-1 bg-canvas px-6 pb-8 pt-16">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-bold text-ink">StudyFlow</Text>
        <Pressable onPress={finish}>
          <Text className="font-semibold text-muted">Skip</Text>
        </Pressable>
      </View>
      <View className="flex-1 justify-center">
        <Animated.View key={step} entering={FadeIn.duration(260)} exiting={FadeOut.duration(120)}>
          <Text className="text-center text-sm font-semibold text-muted">Step {step + 1} of 4</Text>
          <View className="h-40" accessibilityLabel="Illustration area reserved for onboarding artwork" />
          <Text className="text-center text-3xl font-bold text-ink">{current[0]}</Text>
          <Text className="mt-4 text-center text-base leading-6 text-muted">{current[1]}</Text>
        </Animated.View>
        <View className="mt-8 flex-row justify-center gap-2">
          {steps.map((_, index) => <View key={index} className={`h-2 w-2 rounded-full ${index === step ? 'bg-accent' : 'bg-line'}`} />)}
        </View>
      </View>
      <Pressable
        className="items-center rounded-full bg-accent py-4 active:opacity-80"
        onPress={() => (step === steps.length - 1 ? void finish() : setStep((value) => value + 1))}
      >
        <Text className="font-bold text-canvas">{step === steps.length - 1 ? 'Finish' : 'Next'}</Text>
      </Pressable>
    </View>
  );
}
