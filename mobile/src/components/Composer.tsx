import { forwardRef } from 'react'
import { ActivityIndicator, Image, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { font, mealColor, radius, useTheme } from '@/theme'
import { Dot, IconButton, Press, T } from './ui'

interface Props {
  value: string
  onChange: (v: string) => void
  imageUri: string | null
  onClearImage: () => void
  onPick: (source: 'camera' | 'library') => void
  onSubmit: () => void
  busy: boolean
  placeholder: string
  mealKey: string
  mealLabel: string
  timeLabel: string
  overridden: boolean
  onClearMeal: () => void
}

// The logging bar: type or snap a photo, press send. The meal is chosen from the time, shown as a quiet pill.
export const Composer = forwardRef<TextInput, Props>(function Composer(p, ref) {
  const t = useTheme()
  const canSend = !p.busy && (p.value.trim().length > 0 || !!p.imageUri)

  return (
    <View
      style={{
        backgroundColor: t.card,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: t.line,
        padding: 12,
        gap: 8,
        shadowColor: t.shadow,
        shadowOpacity: t.dark ? 0.5 : 0.12,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 10 },
        elevation: 10,
      }}
    >
      {p.imageUri && (
        <View style={{ alignSelf: 'flex-start' }}>
          <Image source={{ uri: p.imageUri }} style={{ width: 72, height: 72, borderRadius: 14 }} />
          <Press
            onPress={p.onClearImage}
            accessibilityLabel="Remove photo"
            hitSlop={10}
            style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: '#000c', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={14} color="#fff" />
          </Press>
        </View>
      )}

      <TextInput
        ref={ref}
        value={p.value}
        onChangeText={p.onChange}
        editable={!p.busy}
        multiline
        maxLength={600}
        placeholder={p.placeholder}
        placeholderTextColor={t.muted}
        accessibilityLabel="Describe what you ate or did"
        selectionColor={t.accent}
        cursorColor={t.accent}
        style={{ fontFamily: font.regular, fontSize: 17, lineHeight: 23, color: t.text, minHeight: 46, maxHeight: 118, paddingHorizontal: 4, paddingTop: 4, textAlignVertical: 'top' }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <IconButton name="camera-outline" label="Take a photo" onPress={() => p.onPick('camera')} disabled={p.busy} color={t.accent} />
        <IconButton name="image-outline" label="Choose a photo" onPress={() => p.onPick('library')} disabled={p.busy} color={t.accent} />

        <Press
          onPress={p.overridden ? p.onClearMeal : undefined}
          haptic={p.overridden ? 'select' : false}
          accessibilityLabel={p.overridden ? `Adding to ${p.mealLabel}. Tap to use the time instead.` : `${p.mealLabel}, chosen from the time`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 4, paddingHorizontal: 11, height: 32, borderRadius: radius.pill, backgroundColor: t.card2 }}
        >
          <Dot color={mealColor[p.mealKey]} />
          <T variant="caption" style={{ fontFamily: font.semibold }}>
            {p.overridden ? `Adding to ${p.mealLabel}` : p.mealLabel}
          </T>
          {!p.overridden && (
            <T variant="caption" muted style={{ fontSize: 12 }}>
              {p.timeLabel}
            </T>
          )}
          {p.overridden && <Ionicons name="close" size={12} color={t.muted} />}
        </Press>

        <View style={{ flex: 1 }} />

        <Press onPress={p.onSubmit} disabled={!canSend} haptic="press" accessibilityRole="button" accessibilityLabel="Log it" style={{ opacity: canSend ? 1 : 0.4 }}>
          <LinearGradient colors={[t.btnA, t.btnB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
            {p.busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-up" size={22} color="#fff" />}
          </LinearGradient>
        </Press>
      </View>
    </View>
  )
})
