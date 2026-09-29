import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'nativewind';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'studyflow-mobile-appearance';

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const { setColorScheme } = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      if (value === 'system' || value === 'light' || value === 'dark') setPreferenceState(value);
    });
  }, []);

  useEffect(() => {
    setColorScheme(preference);
  }, [preference, setColorScheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    setPreference(next) {
      setPreferenceState(next);
      void AsyncStorage.setItem(STORAGE_KEY, next);
    },
  }), [preference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
