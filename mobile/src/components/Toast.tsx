import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { radius, useTheme } from '@/theme'
import { Press, T } from './ui'

interface Toast {
  msg: string
  action?: { label: string; run: () => void }
}

type Show = (msg: string, action?: Toast['action']) => void
const Ctx = createContext<Show>(() => {})
export const useToast = () => useContext(Ctx)

// A banner that drops in from the top, with an optional Undo. Auto-dismisses.
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [toast, setToast] = useState<Toast | null>(null)
  const y = useSharedValue(-140)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = useCallback(() => {
    y.value = withTiming(-140, { duration: 220 })
  }, [y])

  const show = useCallback<Show>(
    (msg, action) => {
      if (timer.current) clearTimeout(timer.current)
      setToast({ msg, action })
      y.value = withSpring(0, { damping: 16, stiffness: 220 })
      timer.current = setTimeout(hide, action ? 6000 : 3000)
    },
    [hide, y],
  )

  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))

  return (
    <Ctx.Provider value={show}>
      {children}
      <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 100 }, anim]}>
        {toast && (
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: radius.lg,
              backgroundColor: t.dark ? '#23232c' : '#16161d',
              shadowColor: '#000',
              shadowOpacity: 0.3,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
            }}
          >
            <T variant="callout" style={{ color: '#fff', flex: 1 }} numberOfLines={2}>
              {toast.msg}
            </T>
            {toast.action && (
              <Press
                haptic="press"
                hitSlop={10}
                onPress={() => {
                  toast.action!.run()
                  hide()
                }}
              >
                <T variant="headline" style={{ color: '#b8adff' }}>
                  {toast.action.label}
                </T>
              </Press>
            )}
          </View>
        )}
      </Animated.View>
    </Ctx.Provider>
  )
}
