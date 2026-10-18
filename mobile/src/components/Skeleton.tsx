import { useEffect } from 'react'
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { radius, useTheme } from '@/theme'

// A softly pulsing placeholder shown while the AI is working.
export function Skeleton({ height = 70 }: { height?: number }) {
  const t = useTheme()
  const o = useSharedValue(0.5)
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1)
  }, [o])
  const style = useAnimatedStyle(() => ({ opacity: o.value }))
  return <Animated.View style={[{ height, borderRadius: radius.md, backgroundColor: t.card2, borderWidth: 1, borderColor: t.line }, style]} />
}
