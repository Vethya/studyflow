import 'react-native-gesture-handler';
import '../../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ReduceMotion, ReducedMotionConfig } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '../providers/auth-provider';
import { PersistedQueryProvider } from '../providers/query-provider';
import { ThemeProvider, useTheme } from '../providers/theme-provider';
import { NetworkBanner } from '../components/network-banner';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PersistedQueryProvider>
        <ThemeProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
      </PersistedQueryProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { preference } = useTheme();
  return (
    <>
      <NetworkBanner />
      <StatusBar style={preference === 'light' ? 'dark' : 'light'} />
      <ReducedMotionConfig mode={ReduceMotion.System} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: preference === 'light' ? '#F8FAFC' : '#08090A' },
        }}
      >
        <Stack.Screen name="auth" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="account" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="search" options={{ presentation: 'transparentModal', animation: 'fade' }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="schedule-revisions" />
        <Stack.Screen name="import/google" />
        <Stack.Screen name="task/new" />
        <Stack.Screen name="availability/edit" />
        <Stack.Screen name="session-outcome" options={{ presentation: 'formSheet', animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}
