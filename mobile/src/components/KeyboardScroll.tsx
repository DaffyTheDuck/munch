import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Keyboard, ScrollView, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native'

// A ScrollView that keeps the focused text field visible above the keyboard on Android and iOS.
// (`automaticallyAdjustKeyboardInsets` only exists on iOS, so on Android the keyboard used to cover the field.)
//
// It measures where the scroll area really ends on screen and where the keyboard starts, so it is correct whether
// or not the OS has already resized the window: it adds only the missing space, then scrolls the field into view.
export const KeyboardScroll = forwardRef<ScrollView, ScrollViewProps>(function KeyboardScroll({ contentContainerStyle, onScroll, children, ...rest }, ref) {
  const scroller = useRef<ScrollView>(null)
  const frame = useRef<View>(null)
  const offset = useRef(0)
  const [pad, setPad] = useState(0)
  useImperativeHandle(ref, () => scroller.current as ScrollView)

  const reveal = useCallback((keyboardTop: number) => {
    const field = TextInput.State.currentlyFocusedInput?.()
    const box = frame.current
    if (!field || !box) return
    box.measureInWindow((_x, boxY, _w, boxH) => {
      const overlap = Math.max(0, boxY + boxH - keyboardTop)
      setPad(overlap)
      field.measureInWindow((_fx, fy, _fw, fh) => {
        const margin = 24
        const hidden = fy + fh + margin - (boxY + boxH - overlap) // how far the field sits below the visible area
        const above = boxY + 8 - fy // or above it (e.g. under the status bar)
        if (hidden > 0) scroller.current?.scrollTo({ y: offset.current + hidden, animated: true })
        else if (above > 0) scroller.current?.scrollTo({ y: Math.max(0, offset.current - above), animated: true })
      })
    })
  }, [])

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setTimeout(() => reveal(e.endCoordinates.screenY), 30))
    const hide = Keyboard.addListener('keyboardDidHide', () => setPad(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [reveal])

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y
    onScroll?.(e)
  }

  return (
    <View ref={frame} collapsable={false} style={{ flex: 1 }}>
      <ScrollView
        ref={scroller}
        scrollEventThrottle={32}
        onScroll={handleScroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[contentContainerStyle, pad ? { paddingBottom: pad + 24 } : null]}
        {...rest}
      >
        {children}
      </ScrollView>
    </View>
  )
})
