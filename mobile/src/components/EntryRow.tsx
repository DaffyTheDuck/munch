import { useRef } from 'react'
import { Image, View } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import { Ionicons } from '@expo/vector-icons'
import type { Entry } from '@shared/types'
import { radius, useTheme } from '@/theme'
import { feel } from '@/lib/feel'
import { Badge, Press, T } from './ui'

interface Props {
  entry: Entry
  color: string
  onOpen: () => void
  onDuplicate: () => void
  onDelete: () => void
}

// One logged item. Tap to edit, swipe right to duplicate, swipe left to delete (with undo).
export function EntryRow({ entry: e, color, onOpen, onDuplicate, onDelete }: Props) {
  const t = useTheme()
  const ref = useRef<SwipeableMethods>(null)
  const isFood = e.kind === 'food'

  const action = (bg: string, icon: keyof typeof Ionicons.glyphMap, side: 'left' | 'right') => (
    <View style={{ width: 92, backgroundColor: bg, alignItems: side === 'left' ? 'flex-start' : 'flex-end', justifyContent: 'center', paddingHorizontal: 28, borderRadius: radius.md, marginVertical: 0 }}>
      <Ionicons name={icon} size={24} color="#fff" />
    </View>
  )

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      leftThreshold={56}
      rightThreshold={56}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableWillOpen={() => feel.select()}
      onSwipeableOpen={(dir) => {
        feel.press()
        // gesture-handler 2.x reports the direction the ROW moved: 'right' = swiped right = left panel (duplicate).
        if (dir === 'right') onDuplicate()
        else onDelete()
        ref.current?.close()
      }}
      renderLeftActions={() => action(t.accent, 'copy-outline', 'left')}
      renderRightActions={() => action(t.over, 'trash-outline', 'right')}
      containerStyle={{ borderRadius: radius.md }}
    >
      <Press
        onPress={onOpen}
        haptic={false}
        scale={0.985}
        accessibilityRole="button"
        accessibilityLabel={`${e.name}, ${e.calories} calories. Double tap to edit.`}
        accessibilityActions={[
          { name: 'duplicate', label: 'Duplicate' },
          { name: 'delete', label: 'Delete' },
        ]}
        onAccessibilityAction={(ev) => (ev.nativeEvent.actionName === 'delete' ? onDelete() : onDuplicate())}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          paddingLeft: 14,
          backgroundColor: t.card,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: t.line,
          borderLeftWidth: 3,
          borderLeftColor: color,
        }}
      >
        {e.photo ? (
          <Image source={{ uri: e.photo }} style={{ width: 46, height: 46, borderRadius: 13 }} />
        ) : (
          <View style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: t.card2, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={isFood ? 'restaurant-outline' : 'flame-outline'} size={20} color={isFood ? t.muted : '#fb923c'} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
              {e.name}
            </T>
            {e.servings && e.servings !== 1 ? <Badge label={`×${e.servings}`} tone="accent" /> : null}
            {e.source === 'usda' ? <Badge label="USDA" tone="accent" /> : e.source === 'edited' ? <Badge label="EDITED" tone="warn" /> : e.source === 'ai' ? <Badge label="EST." /> : e.source === 'local' ? <Badge label="MATCH" tone="accent" /> : null}
          </View>
          <T variant="caption" muted numberOfLines={1}>
            {e.quantity}
            {isFood ? `  ·  P ${e.protein}  C ${e.carbs}  F ${e.fat}` : ''}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T variant="headline" color={isFood ? 'text' : 'good'} style={{ fontVariant: ['tabular-nums'] }}>
            {isFood ? '' : '−'}
            {e.calories}
          </T>
          <T variant="caption" muted style={{ fontSize: 11, lineHeight: 13 }}>
            kcal
          </T>
        </View>
      </Press>
    </ReanimatedSwipeable>
  )
}
