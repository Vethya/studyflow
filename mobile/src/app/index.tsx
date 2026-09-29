import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';

import { hasCompletedOnboarding } from '../lib/onboarding-storage';
import { useAuth } from '../providers/auth-provider';

export default function Index() {
  const { isLoading, session } = useAuth();
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  useEffect(() => {
    if (session) void hasCompletedOnboarding().then(setOnboardingComplete);
  }, [session]);

  if (isLoading || (session && onboardingComplete === null)) return null;
  return <Redirect href={session ? (onboardingComplete ? '/(tabs)' : '/onboarding') : '/auth'} />;
}
