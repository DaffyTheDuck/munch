import { useEffect } from 'react'
import { View } from 'react-native'
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg'
import Animated, { useAnimatedProps, useSharedValue, withTiming, Easing } from 'react-native-reanimated'
import { useTheme } from '@/theme'
import { useCountUp } from '@/lib/hooks'
import { T } from './ui'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const SIZE = 200
const STROKE = 14
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

// The daily calorie ring: draws itself in, and the centre number counts to its value.
export function Ring({ progress, remaining }: { progress: number; remaining: number }) {
  const t = useTheme()
  const over = remaining < 0
  const p = useSharedValue(0)
  const shown = useCountUp(Math.abs(Math.round(remaining)))

  useEffect(() => {
    p.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 900, easing: Easing.out(Easing.cubic) })
  }, [progress, p])

  const animatedProps = useAnimatedProps(() => ({ strokeDasharray: `${C * p.value} ${C}` }))

  return (
    <View
      style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${Math.abs(Math.round(remaining))} calories ${over ? 'over' : 'remaining'}`}
    >
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={over ? t.over : t.accent} />
            <Stop offset="1" stopColor={over ? t.over : t.accent2} />
          </LinearGradient>
        </Defs>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={t.card2} strokeWidth={STROKE} fill="none" />
        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke="url(#ring)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          rotation={-90}
          originX={SIZE / 2}
          originY={SIZE / 2}
          animatedProps={animatedProps}
        />
      </Svg>
      <T variant="largeTitle" color={over ? 'over' : 'text'} style={{ fontSize: 44, lineHeight: 50, fontVariant: ['tabular-nums'] }}>
        {shown.toLocaleString()}
      </T>
      <T variant="caption" muted>
        kcal {over ? 'over' : 'left'}
      </T>
    </View>
  )
}
