import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'studyflow-mobile-onboarding-complete';

export async function hasCompletedOnboarding(): Promise<boolean> {
  return (await AsyncStorage.getItem(STORAGE_KEY)) === 'true';
}

export async function completeOnboarding(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, 'true');
}
