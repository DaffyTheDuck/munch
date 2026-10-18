import { getApps, initializeApp } from 'firebase/app'
import { getReactNativePersistence, initializeAuth, type Auth } from 'firebase/auth'
import { initializeFirestore, type Firestore } from 'firebase/firestore'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Config comes from EXPO_PUBLIC_* variables in mobile/.env (see mobile/.env.example).
// Without them the app runs local-only, and still works in Expo Go.
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
}

export const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId)

let auth: Auth | null = null
let firestore: Firestore | null = null

if (firebaseConfigured) {
  const app = getApps()[0] ?? initializeApp(config)
  // Keep the user signed in between launches
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
  firestore = initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
}

export { auth, firestore }
