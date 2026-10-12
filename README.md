# Qingying — Lightness Plan

> A weight-management app for Chinese home-style fat-loss cooking and home workouts.
> Runs as an installable PWA in any mobile browser, and can be packaged into a standalone Android APK.

**🌐 Language: English | [Chinese (Simplified)](README.zh-CN.md)**

---

## Table of Contents

- [What is Qingying](#what-is-qingying)
- [Features](#features)
- [AI food photo recognition](#ai-food-photo-recognition)
- [Camera & voice input](#camera--voice-input)
- [Building the Android APK](#building-the-android-apk)
- [Deploying as a PWA](#deploying-as-a-pwa)
- [Project structure](#project-structure)
- [Android permissions](#android-permissions)
- [Privacy](#privacy)

## What is Qingying

Qingying ("Lightness Plan") is a single-page web app for people who want to lose
fat while eating ordinary Chinese home cooking — rice, stir-fries, soups, dumplings — rather than
salads and chicken breast. It tracks what you eat, how much you weigh, and whether you moved today,
with a food database of **100 Chinese home-style dishes** measured in grams.

The whole app is a static bundle (HTML + CSS + vanilla JavaScript, no build step, no framework,
no backend). All data lives in the browser's `localStorage` on your own device.

## Features

**Today**
- Calorie ring for the day, with a target derived from your body data
- Check-ins for meals, workouts, weight and water
- Suggested fat-loss meal of the day, loggable in one tap
- Reminder banners for meal times and workout time
- Voice read-out 🔊 of today's calories, protein, weight and workout status

**Food log**
- Pick a category → pick a food → pick a gram amount, calories and protein are computed automatically
- Manual entry with free-form text
- AI photo recognition (see below)
- Native voice input (see below)
- Attach a photo as evidence for a meal

**Records**
- Weight in *jin* (a Chinese unit, 1 jin = 500 g), with a trend line
- 14-day calorie intake bar chart
- Browse the diet history by date
- Attach a photo of the scale

**Plan**
- Weekly workout plan
- Weekly fat-loss meal plan
- Personal settings (sex, age, height, weight, goal weight, activity level, calorie deficit)
- Backup & restore via an exportable backup code

Every food entry stores **kcal and protein per 100 g** plus a few common portion sizes
(50 / 100 / 150 / 200 / 300 g), so you can either tap a preset or type any weight you like.

## AI food photo recognition

Since v2.0 you can point the camera at a meal, and the app sends the photo to a vision model that
returns the **food name, estimated weight in grams, calories and protein**. You can then adjust the
grams and the calories are recalculated proportionally before you save the entry.

- A free AI vision model is used by default, at no cost for everyday use
- **You need your own API key.** Register at [open.bigmodel.cn](https://open.bigmodel.cn) (free tier),
  create an API key, and paste it into the app under **Plan → Settings → Photo recognition**
- The endpoint URL and model name are configurable in the same screen, so any OpenAI-compatible
  vision API can be used instead
- Without a key, the app shows a short setup guide and everything else keeps working normally

> The photo is only sent when you tap the recognition button. Nothing is uploaded in the background.

## Camera & voice input

v2.0 replaces the old web-only implementations with **Capacitor native plugins**:

| Capability | Implementation | Why it changed |
| --- | --- | --- |
| 📷 Camera | [`@capacitor/camera`](https://capacitorjs.com/docs/apis/camera) | The HTML `<input capture>` trick silently fails on HarmonyOS / Huawei WebViews. The native plugin opens the system camera reliably and offers "take photo / choose from gallery". |
| 🎤 Voice input | [`@capacitor-community/speech-recognition`](https://github.com/capacitor-community/speech-recognition) | The Web Speech API is not available inside an app WebView, so the button never appeared. The native plugin calls the phone's built-in speech engine (available on HarmonyOS) instead. |
| 🔊 Voice output | Web Speech Synthesis | Works everywhere, no change needed. |

Spoken input is parsed into grams automatically: saying "one bowl of rice" fills in
**rice, 150 g**. Chinese numerals and measure words (bowl / plate / piece / liang / jin …) are
converted using a per-category lookup table.

**Weight unit note:** body weight is stored in *jin*, the Chinese unit equal to 500 g.
Food weights are always in grams.

## Building the Android APK

> ⚠️ **Important:** because v2.0 depends on native plugins, TWA-based wrappers such as
> **PWABuilder and Bubblewrap cannot produce a working APK** — a TWA runs inside Chrome and has no
> access to native camera or speech APIs. Use **Capacitor**.

### Prerequisites

- Node.js 18+
- **JDK 21** (Capacitor 8 requires Java 21 to compile)
- Android SDK with `platforms;android-36` and `build-tools;36.0.0`
- A keystore for signing release builds

### Steps

```bash
# 1. Create the Capacitor project (once)
mkdir qingying-android && cd qingying-android
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/camera @capacitor-community/speech-recognition

# 2. Copy the web app into www/ and create capacitor.config.json
#    (appId com.qingying.app, webDir "www", plugins.CapacitorHttp.enabled = true)

# 3. Generate the Android project (once)
npx cap add android

# 4. Sync web assets + plugins, then build
npx cap sync android
cd android
./gradlew assembleRelease
```

The signed APK ends up in
`android/app/build/outputs/apk/release/app-release.apk`.

**Two gotchas worth knowing:**

1. **`CapacitorHttp` must be enabled** in `capacitor.config.json`. Otherwise the AI request from
   inside the WebView is blocked by CORS. The native HTTP layer bypasses it.
2. **Declare the speech service in `AndroidManifest.xml`.** Android 11+ package visibility rules
   hide the system speech recogniser unless you add:

   ```xml
   <queries>
     <intent><action android:name="android.speech.RecognitionService" /></intent>
   </queries>
   ```

   Without it, `SpeechRecognizer` reports itself as unavailable and voice input silently breaks.

When bumping a version, remember to increase **`versionCode`** as well as `versionName`, or Android
will refuse to install the update over the previous build.

## Deploying as a PWA

The app needs no server — any static host works. On GitHub:

**Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`**,
then open `https://<your-username>.github.io/qingying/`.

On Android Chrome you can then use **Add to Home screen** to install it like a native app.

> After changing any code, bump the `CACHE` constant in `sw.js` (e.g. `qingying-v3` → `qingying-v4`)
> so installed clients pick up the new version.

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Page skeleton (includes the photo viewer and camera input) |
| `styles.css` | Styles — automatic light/dark theme, photo/voice/speech UI |
| `data.js` | Food database, workout plan, fat-loss meal plan |
| `app.js` | Application logic — logging, charts, camera, speech, AI recognition |
| `manifest.json` | PWA metadata and home-screen shortcuts |
| `sw.js` | Service worker for offline use |
| `icons/` | App icons (192 / 512, including maskable) |

## Android permissions

| Permission | Used for |
| --- | --- |
| `CAMERA` | 📷 Photo evidence for meals, scale readings and workouts |
| `RECORD_AUDIO` | 🎤 Voice input |
| `INTERNET` | 🤖 Sending a photo to the AI service when you tap recognition |
| `VIBRATE`, `POST_NOTIFICATIONS` | 🔔 Meal-time and workout reminders |
| `WRITE_EXTERNAL_STORAGE` / `READ_EXTERNAL_STORAGE` (maxSdkVersion 32) | 💾 Exporting the backup code to a file on Android 12 and below |

## Privacy

- All data — meals, weight, workouts, photos and settings — is stored **only on your device** in
  `localStorage`. There is no account, no server, no analytics and no telemetry.
- Photos are compressed locally (max width 800 px, JPEG quality 0.7) and never leave the device,
  except the one photo you explicitly submit for AI recognition.
- Your AI API key is stored in `localStorage` on your own device and is sent only to the endpoint you
  configure.

---

**Chinese documentation: [README.zh-CN.md](README.zh-CN.md).**
