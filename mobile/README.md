# Journable mobile (Android first)

Expo (React Native) app that shares its core logic with the web app (`../shared`: types, goal calculator, date and meal helpers) and talks to the same API server.

## Run it on your Android phone (no Android Studio needed)

> **SDK note:** the app is on **Expo SDK 57** because that is what the Play Store's Expo Go supports right now. SDK 58 was released on Oct 15, 2026 but its Expo Go reaches the stores "within a few weeks"; a project on a newer SDK than your Expo Go shows *"Project is incompatible with this version of Expo Go"*. Once the SDK 58 Expo Go is on the Play Store, upgrade with `npx expo install expo@^58 --fix` (and re-run `npm run typecheck`). Recent Expo Go versions may also ask you to sign in with a free Expo account.

1. Install (or update) **Expo Go** from the Play Store.
2. On your computer, start the API server from the repo root: `npm run dev` (or `npm run start:api`).
3. Start the app: `npm run mobile` from the repo root (Expo Go). Use `npm run mobile:clear` for a clean start, or `npm run mobile:lite` to cap Metro's memory use.
4. Make sure the phone is on the **same Wi-Fi** as the computer, then scan the QR code with Expo Go.
5. If Windows asks, allow Node.js through the firewall (private networks), otherwise the phone can't reach the server.

The app finds the server automatically (your computer's address, port 8787). If it can't, open **Goals → Server**, type `http://<your-computer-ip>:8787` and tap **Save & test**.

## Google sign-in and sync

Off by default: without Firebase config the app is local-only and works in Expo Go. To turn it on you need a **development build** (Google sign-in is a native module and cannot run in Expo Go). Full steps in [../SETUP-FIREBASE.md](../SETUP-FIREBASE.md); the short version is `eas build --profile development --platform android`, install the APK, then run `npm run mobile:dev`.

## What's in it

- **Today**: calorie ring, macro bars, last-7-days strip, meals chosen from your local time, "Log again" chips, swipe right to duplicate / left to delete (with undo), tap to edit in a bottom sheet, photo logging (camera or gallery).
- **Coach**: the LangGraph agent, running its tools on data stored on the phone.
- **Weight**: trend chart, stepper entry, history.
- **Goals**: auto-calculated plan from your target weight, daily targets, server settings.
- Haptics on taps, steppers, swipe actions and success/error; respects reduce-motion and large text; light and dark themes follow the system.

Data is stored on the phone in SQLite. It is separate from the web app's data (no sync yet).

## Useful commands

```bash
npm run typecheck   # tsc --noEmit
npm run bundle      # export an Android bundle (verifies everything compiles and resolves)
npx expo-doctor     # dependency and config health check
```

## Building an installable APK (later)

`npx eas-cli@latest build --platform android --profile preview` builds in Expo's cloud, so Android Studio is still not needed. The app's cleartext (http) traffic is enabled in `app.json` so it can reach a server on your home network; if you deploy the server over HTTPS you can turn that off.

## Notes

- Android package id is `com.mihir.journablelocal` (deliberately different from the Play Store app).
- Custom icons and splash are generated from the logo with `node scripts/make-mobile-assets.mjs` (run from the repo root).

## Install on your phone as an APK

1. Fill `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (and optionally `EXPO_PUBLIC_API_URL`) in the `preview` profile of `eas.json`.
2. `npm i -g eas-cli`, then `eas login`, `eas init`, `eas build --profile preview --platform android`.
3. Open the build link on the phone, download and install the APK (allow "install unknown apps").
4. For Google sign-in: `eas credentials` shows the SHA-1; add an Android app in Firebase (package `com.mihir.journablelocal`) with that SHA-1.
5. Run the server on your computer (`npm run start:api`), then set Goals → Server to `http://<computer-ip>:8787` (same Wi-Fi, allow Node through the firewall).
