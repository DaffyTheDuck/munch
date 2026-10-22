import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { font, useTheme } from '@/theme'
import { feel } from '@/lib/feel'

type Icon = keyof typeof Ionicons.glyphMap

const TABS: { name: string; title: string; icon: Icon; active: Icon }[] = [
  { name: 'index', title: 'Today', icon: 'today-outline', active: 'today' },
  { name: 'plan', title: 'Plan', icon: 'restaurant-outline', active: 'restaurant' },
  { name: 'coach', title: 'Coach', icon: 'chatbubble-ellipses-outline', active: 'chatbubble-ellipses' },
  { name: 'weight', title: 'Progress', icon: 'trending-up-outline', active: 'trending-up' },
  { name: 'goals', title: 'Goals', icon: 'flag-outline', active: 'flag' },
]

export default function TabsLayout() {
  const t = useTheme()
  return (
    <Tabs
      screenListeners={{ tabPress: () => feel.select() }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 11 },
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line, borderTopWidth: 1, elevation: 0 },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => <Ionicons name={focused ? tab.active : tab.icon} size={size} color={color as string} />,
          }}
        />
      ))}
    </Tabs>
  )
}
