import type { WidgetTaskHandlerProps } from 'react-native-android-widget'
import { loadWidgetData } from './data'
import { WIDGETS, type WidgetName } from './ui'

// Android calls this (in the background, even when the app is closed) when a widget is added, resized or
// refreshed. It draws from the local database, so it needs no network.
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const name = props.widgetInfo.widgetName as WidgetName
  const draw = WIDGETS[name]
  if (!draw) return
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(draw(await loadWidgetData()))
      break
    default:
      break // clicks are handled natively (they open the app)
  }
}
