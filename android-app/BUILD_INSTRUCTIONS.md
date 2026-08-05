# 🚀 Fleetly GPS — Android APK Build Instructions

## Overview

This folder contains the complete Android app project for **Fleetly GPS Tracker**.  
The app is a WebView wrapper built with [Capacitor](https://capacitorjs.com/) that displays your existing customer web interface.

---

## 📋 Prerequisites

Before building, install these tools:

| Tool | Download | Version Required |
|------|----------|-----------------|
| **Android Studio** | [developer.android.com/studio](https://developer.android.com/studio) | Hedgehog 2023.1+ |
| **JDK 17** | [adoptium.net](https://adoptium.net/) | 17+ |
| **Node.js** | Already installed ✅ | v24 |

---

## ⚙️ Step 1: Set Your Server URL

Open `capacitor.config.json` and replace `YOUR_SERVER_URL_HERE` with your live server URL:

```json
{
  "server": {
    "url": "https://your-ngrok-or-railway-url.com",
    "cleartext": true
  }
}
```

**Examples:**
- **ngrok:** `https://abc123.ngrok-free.app`  
- **Railway:** `https://your-app.up.railway.app`
- **Local testing:** `http://192.168.1.100:3000` (your PC's LAN IP)

> ⚠️ Do NOT use `localhost` — the Android emulator/device cannot reach your PC's localhost. Use your actual IP address or a public URL.

---

## 📦 Step 2: Install Capacitor Dependencies

Open a terminal in this `android-app/` folder and run:

```bash
npm install
```

---

## 🤖 Step 3: Open in Android Studio

### Option A: Via Command Line
```bash
npx cap open android
```

### Option B: Manually
1. Open **Android Studio**
2. Click **"Open"**
3. Navigate to `c:\PROJECT\android-app\android\`
4. Click **OK** and wait for Gradle sync to complete

---

## 🔨 Step 4: Build the APK

### Debug APK (for testing / sideloading):
In Android Studio:
1. Menu → **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
2. Wait for build to complete (~2-5 minutes first time)
3. Click **"locate"** in the notification to find the APK

The debug APK will be at:
```
android-app\android\app\build\outputs\apk\debug\app-debug.apk
```

### Release APK (for distribution):
1. Menu → **Build** → **Generate Signed Bundle / APK**
2. Choose **APK**
3. Create a new keystore (save it safely — you need it for all future updates!)
4. Fill in details → **Build**

---

## 📲 Step 5: Deploy the APK

### Copy to your web server for download:
```bash
copy android\app\build\outputs\apk\debug\app-debug.apk ..\public\app.apk
```

Customers can then download it from:
- **Download page:** `https://your-server/download.html`
- **Direct download:** `https://your-server/app.apk`

---

## 🔧 Updating the App

When you update your web app (customer.html), the app auto-updates since it loads the URL live.  
You only need to rebuild and redistribute the APK when you change:
- App permissions
- App name or icon
- capacitor.config.json settings

To sync Capacitor after changes:
```bash
npx cap sync android
```

---

## 🎨 Customization

### Change App Icon
Replace the PNG files in:
```
android/app/src/main/res/mipmap-*/ic_launcher.png
android/app/src/main/res/mipmap-*/ic_launcher_round.png
```

Sizes needed:
- `mipmap-mdpi/` → 48×48px
- `mipmap-hdpi/` → 72×72px  
- `mipmap-xhdpi/` → 96×96px
- `mipmap-xxhdpi/` → 144×144px
- `mipmap-xxxhdpi/` → 192×192px

### Change App Name
Edit `android/app/src/main/res/values/strings.xml`:
```xml
<string name="app_name">Your App Name</string>
```

### Change Package ID
Edit `android/app/build.gradle`:
```gradle
applicationId "com.yourcompany.yourapp"
```
Also update `AndroidManifest.xml` and `capacitor.config.json` to match.

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| App shows blank white screen | Check server URL in `capacitor.config.json` |
| App can't connect to server | Ensure `cleartext: true` for HTTP, or use HTTPS |
| Build fails with Gradle error | Make sure JDK 17 is installed and `JAVA_HOME` is set |
| Icons not showing | Rebuild after copying icon files |
| "Install blocked" on phone | Enable "Install unknown apps" in Android Settings |

---

## 📁 Project Structure

```
android-app/
├── capacitor.config.json     ← Main config (set your server URL here!)
├── package.json
├── www/
│   └── index.html            ← Loading screen (auto-redirects to server)
└── android/                  ← Android Studio project
    ├── app/
    │   ├── build.gradle
    │   ├── capacitor.build.gradle
    │   └── src/main/
    │       ├── AndroidManifest.xml
    │       ├── java/com/fleetly/gpstracker/
    │       │   └── MainActivity.java
    │       └── res/
    │           ├── drawable/splash.png
    │           ├── mipmap-*/ic_launcher*.png
    │           ├── values/strings.xml
    │           ├── values/styles.xml
    │           └── xml/
    │               ├── network_security_config.xml
    │               └── file_paths.xml
    ├── build.gradle
    ├── settings.gradle
    ├── gradle.properties
    └── gradle/wrapper/
        └── gradle-wrapper.properties
```
