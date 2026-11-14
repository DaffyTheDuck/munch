// App entry. Same as Expo Router's default entry, plus the handler Android calls to draw the home-screen widgets.
import { registerWidgetTaskHandler } from 'react-native-android-widget'
import { widgetTaskHandler } from './src/widgets/task-handler'
import 'expo-router/entry'

registerWidgetTaskHandler(widgetTaskHandler)
