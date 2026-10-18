import { type ReactNode } from 'react'
import { Pressable, Text, View, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { font, radius, useTheme, type Theme } from '@/theme'
import { feel } from '@/lib/feel'

// ---------------------------------------------------------------- Text

type Variant = 'largeTitle' | 'title' | 'headline' | 'body' | 'callout' | 'caption' | 'label'

const VARIANTS: Record<Variant, TextStyle> = {
  largeTitle: { fontFamily: font.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  title: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  headline: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
  callout: { fontFamily: font.medium, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: font.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 1, textTransform: 'uppercase' },
}

export function T({
  variant = 'body',
  color,
  muted,
  style,
  ...props
}: TextProps & { variant?: Variant; color?: keyof Theme; muted?: boolean }) {
  const t = useTheme()
  const c = color ? (t[color] as string) : muted ? t.muted : t.text
  return <Text {...props} style={[VARIANTS[variant], { color: c }, style]} />
}

// ---------------------------------------------------------------- Surfaces

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return (
    <View
      style={[
        {
          backgroundColor: t.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: t.line,
          padding: 16,
          shadowColor: t.shadow,
          shadowOpacity: t.dark ? 0.35 : 0.06,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: t.dark ? 0 : 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

// ---------------------------------------------------------------- Pressables

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/** A pressable that dips slightly when touched, like a native control. */
export function Press({
  children,
  style,
  haptic = 'tap',
  scale = 0.97,
  onPress,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & { children: ReactNode; style?: StyleProp<ViewStyle>; haptic?: keyof typeof feel | false; scale?: number }) {
  const s = useSharedValue(1)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }))
  return (
    <AnimatedPressable
      {...props}
      onPressIn={() => (s.value = withSpring(scale, { damping: 20, stiffness: 400 }))}
      onPressOut={() => (s.value = withSpring(1, { damping: 14, stiffness: 300 }))}
      onPress={(e) => {
        if (haptic) feel[haptic]()
        onPress?.(e)
      }}
      style={[anim, style]}
    >
      {children}
    </AnimatedPressable>
  )
}

export function IconButton({
  name,
  onPress,
  label,
  size = 22,
  color,
  disabled,
  style,
  haptic = 'tap',
}: {
  name: keyof typeof Ionicons.glyphMap
  onPress: () => void
  label: string
  size?: number
  color?: string
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  haptic?: keyof typeof feel | false
}) {
  const t = useTheme()
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, opacity: disabled ? 0.3 : 1 }, style]}
    >
      <Ionicons name={name} size={size} color={color ?? t.muted} />
    </Press>
  )
}

/** Gradient call-to-action. */
export function PrimaryButton({
  title,
  onPress,
  icon,
  disabled,
  loading,
  style,
}: {
  title: string
  onPress: () => void
  icon?: keyof typeof Ionicons.glyphMap
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const off = disabled || loading
  return (
    <Press onPress={onPress} disabled={off} haptic="press" accessibilityRole="button" accessibilityLabel={title} style={[{ opacity: off ? 0.5 : 1 }, style]}>
      <LinearGradient
        colors={[t.btnA, t.btnB]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ minHeight: 48, borderRadius: radius.md, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
      >
        {icon && <Ionicons name={icon} size={18} color="#fff" />}
        <T variant="headline" style={{ color: '#fff' }}>
          {title}
        </T>
      </LinearGradient>
    </Press>
  )
}

export function SecondaryButton({
  title,
  onPress,
  icon,
  danger,
  style,
}: {
  title: string
  onPress: () => void
  icon?: keyof typeof Ionicons.glyphMap
  danger?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const color = danger ? t.over : t.text
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        { minHeight: 48, borderRadius: radius.md, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: t.card2 },
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={18} color={color} />}
      <T variant="headline" style={{ color }}>
        {title}
      </T>
    </Press>
  )
}

export function Chip({ label, onPress, icon, trailing, selected }: { label: string; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap; trailing?: string; selected?: boolean }) {
  const t = useTheme()
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? t.accent : t.line,
        backgroundColor: selected ? t.accentSoft : t.card,
      }}
    >
      {icon && <Ionicons name={icon} size={14} color={t.accent} />}
      <T variant="callout" numberOfLines={1} style={{ maxWidth: 190 }}>
        {label}
      </T>
      {trailing ? <T variant="caption" muted>{trailing}</T> : null}
    </Press>
  )
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' | 'warn' }) {
  const t = useTheme()
  const bg = tone === 'accent' ? t.accentSoft : tone === 'warn' ? t.card2 : t.card2
  const fg = tone === 'accent' ? t.accentStrong : tone === 'warn' ? t.carbs : t.muted
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill }}>
      <Text style={{ color: fg, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.4 }}>{label}</Text>
    </View>
  )
}
