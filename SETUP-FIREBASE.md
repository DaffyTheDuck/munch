# Google sign-in and sync: setup

The code for Google sign-in and cross-device sync is in place, but it stays **off** until you add a Firebase project. Until then the web app and the phone app work exactly as before (local only, no sign-in screen).

Everything below is free (Firebase "Spark" plan) and takes about 15 minutes for the web app, plus a one-time build for the phone.

> Not tested end to end: I could not create a Firebase project, so the live Google/Firebase flows have only been type-checked and tested against fakes. Follow the steps in order; the troubleshooting section lists the usual first-run problems.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and **Add project** (name it e.g. `journable`; Google Analytics is optional, you can turn it off).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.** Pick a support email and **Save**.
3. **Build → Firestore Database → Create database.** Choose production mode and a nearby location.
4. In Firestore, open the **Rules** tab, paste the contents of [firestore.rules](firestore.rules) and **Publish**. This makes each user's data readable only by that user.

## 2. Web app

1. **Project settings (gear) → General → Your apps → Add app → Web (`</>`)**. Register it (no hosting needed).
2. Copy the config values into the repo's `.env`:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

3. Restart `npm run dev`. The web app now shows the sign-in screen. `localhost` is already an authorised domain; if you deploy the site later, add its domain under **Authentication → Settings → Authorized domains**.

These keys are public identifiers, not secrets (access is controlled by the Firestore rules).

## 3. Protect the AI server (recommended)

Add to `.env`, using the same project id:

```
FIREBASE_PROJECT_ID=your-project-id
ALLOWED_EMAILS=you@gmail.com
```

With `FIREBASE_PROJECT_ID` set, the AI endpoints (`/api/analyze`, `/api/coach*`) require a valid Google sign-in. `ALLOWED_EMAILS` (comma separated) restricts them to your own account(s), so nobody else can spend your Gemini/Groq quota. There is also a per-user rate limit (`RATE_LIMIT_PER_MIN`, default 60). Restart the server; its start-up log says whether auth is on.

## 4. Phone app (Android)

Google sign-in uses a native library, so it does **not** work in Expo Go. You need a *development build* (an APK built in Expo's cloud, no Android Studio). Expo Go keeps working for local-only use.

1. Copy `mobile/.env.example` to `mobile/.env` and fill in the same four Firebase values, plus the **web client ID**:
   - Find it under **Authentication → Sign-in method → Google → Web SDK configuration → Web client ID** (or Google Cloud Console → APIs & Services → Credentials → "Web client (auto created by Google Service)").
   - Put the same values in `mobile/eas.json` under `build.development.env`, because cloud builds do not see your local `.env`.
2. Build and install:

   ```bash
   cd mobile
   npm install -g eas-cli
   eas login
   eas init
   eas build --profile development --platform android
   ```

   Open the link or QR code it prints on your phone and install the APK.
3. Register the build's fingerprint so Google trusts it:
   - Run `eas credentials`, choose **Android → development**, and copy the **SHA-1** of the keystore.
   - In Firebase: **Project settings → Your apps → Add app → Android**, package name `com.mihir.journablelocal`, paste the SHA-1, register. (You do **not** need to download `google-services.json` or add it to the project.)
4. Start the dev server for the dev build with `npm run mobile:dev`, then open the installed app and connect. (`npm run mobile` is still the Expo Go version.)

## How sync behaves

- The app is local-first: it always reads and writes the on-device database, then syncs in the background (after edits, when you return to the app, and every 30 seconds).
- Each sync **downloads first, then uploads**. If the same item was edited on two devices, the **most recent edit wins**.
- Deleting an item also syncs (other devices remove it too).
- First sign-in uploads whatever is already on that device, so your existing log becomes part of your account.
- Signing in with a *different* Google account on a device that already has another account's data asks before replacing it (the other account's data stays in the cloud).
- Photos are stored as small thumbnails with each entry. Full-size photos are never saved.
- Sync uses your phone/computer clock to decide which edit is newer, so keep device clocks on automatic time.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "This address is not authorised in Firebase yet" | Add the domain under Authentication → Settings → Authorized domains. |
| "Google sign-in is not enabled in your Firebase project" | Enable the Google provider (step 1.2). |
| Sync status says "Missing or insufficient permissions" | Publish [firestore.rules](firestore.rules) (step 1.4). |
| Phone: "Google rejected this app build" (DEVELOPER_ERROR / code 10) | The SHA-1 is missing or from a different keystore (step 4.3), or `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is wrong. |
| Phone: "needs the development build" | You are in Expo Go. Install the development build (step 4.2). |
| AI calls fail with "Please sign in" / "not allowed" | Server auth is on: sign in, and check `ALLOWED_EMAILS` contains your Google email. |
| AI calls fail on the phone only | Check Goals → Server points at your computer, and the server is running. |

## For other platforms (later)

iOS needs a Mac or EAS cloud build, an Apple developer account, and the Google Sign-In config plugin with your iOS URL scheme. Not set up here.
