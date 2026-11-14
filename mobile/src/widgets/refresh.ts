import { Platform } from 'react-native'
import { requestWidgetUpdate } from 'react-native-android-widget'
import { loadWidgetData } from './data'
import { WIDGETS, WIDGET_NAMES } from './ui'

let timer: ReturnType<typeof setTimeout> | null = null

/** Redraws every Munch widget that is on the home screen. Safe to call often: it waits a moment and batches. */
export function refreshWidgets(delayMs = 1200) {
  if (Platform.OS !== 'android') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    try {
      const data = await loadWidgetData()
      await Promise.all(WIDGET_NAMES.map((widgetName) => requestWidgetUpdate({ widgetName, renderWidget: () => WIDGETS[widgetName](data) })))
    } catch {
      /* a widget that cannot redraw must never break the app */
    }
  }, delayMs)
}
