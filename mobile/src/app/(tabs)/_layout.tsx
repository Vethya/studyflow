import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useAuth } from '../../providers/auth-provider';
import { useTheme } from '../../providers/theme-provider';

const tabItems = [
  { name: 'index', title: 'Home', symbol: '⌂' },
  { name: 'tasks', title: 'Tasks', symbol: '✓' },
  { name: 'calendar', title: 'Calendar', symbol: '□' },
  { name: 'availability', title: 'Availability', symbol: '◷' },
  { name: 'progress', title: 'Progress', symbol: '↗' },
] as const;

export default function TabsLayout() {
  const { isLoading, session } = useAuth();
  const { preference } = useTheme();
  if (isLoading) return null;
  if (!session) return <Redirect href="/auth" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: preference === 'light' ? '#4A8B23' : '#9BE15D',
        tabBarInactiveTintColor: preference === 'light' ? '#5C6774' : '#78818E',
        tabBarStyle: {
          backgroundColor: preference === 'light' ? '#FFFFFF' : '#111418',
          borderTopColor: preference === 'light' ? '#D6DEE6' : '#28303A',
          height: 84,
          paddingBottom: 22,
          paddingTop: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {tabItems.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, focused }) => (
              <Text style={{ color, fontSize: focused ? 23 : 21, lineHeight: 23 }}>{tab.symbol}</Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
