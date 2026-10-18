import * as Haptics from 'expo-haptics'

// Small, consistent haptic vocabulary. Failures are ignored (not every device has a haptic engine).
const safe = (p: Promise<unknown>) => void p.catch(() => {})

export const feel = {
  /** light tick for taps and steppers */
  tap: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** selection change, e.g. switching a meal or day */
  select: () => safe(Haptics.selectionAsync()),
  /** firmer press, e.g. a swipe action committing */
  press: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
}
