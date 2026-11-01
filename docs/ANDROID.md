# Saathi on Android

The Saathi Android app turns a phone or tablet into Aaji's Saathi screen, or the family app, without a browser around it. It needs Android 8 or newer and a Saathi that can be reached at an https address (Start menu → **Saathi → Reach Saathi from anywhere** on the Saathi computer).

## Install

1. On the phone or tablet, open **https://github.com/akshatinnovate-png/Saathi-Alexa/releases/latest** and tap **Saathi-…apk**.
2. Android asks to allow installing from your browser. Allow it for this one install, then switch it off again in Settings.
3. Open **Saathi**. Type the Saathi address (for example `aaji-pc.tail1a2b.ts.net`), or paste the pairing link shown in the family app under **Devices**.
4. For Aaji's screen: the family approves the device in the family app when both screens show the same three pictures. From then on the app opens straight to Aaji's screen.

To point the app at a different Saathi later, long-press the Saathi icon and choose **Change address**. Changing to a different Saathi wipes the old sign-in from the app.

## What the app does to stay safe

| Protection | What it means |
|---|---|
| One Saathi only | The app opens only the address you typed. Any other link opens in the normal browser, and phone numbers open the dialler without calling |
| https only | Plain http is refused, except for the emulator address used by developers. A bad or self-signed certificate stops the app instead of continuing |
| System certificates only | Certificates someone installed on the phone (a common way to spy on traffic) are not trusted |
| Microphone and camera | Only your Saathi can ask, and Android asks you first. Nothing else on the web page can use them |
| No screenshots | Screenshots, screen recording and the recent-apps preview are blocked, so health details do not end up in a photo gallery or a cloud backup |
| No backups | The app's data is never copied to Google Drive or to a new phone; a new phone pairs again |
| No extras | No location, no pop-up windows, no access to the phone's files except a photo you choose to share, Google Safe Browsing on, WebView usage reports off |
| No third-party code | The app is written only against Android itself. It has no libraries, analytics or advertising SDKs |

## Check the download is genuine

Each APK on the release page is built by GitHub Actions from this repository's public code and carries a signed record of how it was built:

```
gh attestation verify Saathi-1.2.0.apk --repo akshatinnovate-png/Saathi-Alexa
```

`SHA256SUMS-android` lists its SHA-256, and `apk-signature.txt` shows the certificate that signed it.

## For the maintainer: a permanent signing key

Android only lets an app update itself when every version is signed with the same key. Until you add one, each release is signed with a one-off key: it installs, but updating means uninstalling first and pairing again.

Make the key once, on your own computer (Java's `keytool` comes with any JDK or Android Studio):

```
keytool -genkeypair -keystore saathi-release.jks -storetype PKCS12 -alias saathi -keyalg EC -groupname secp256r1 -validity 10000 -dname "CN=Saathi"
```

Choose a long password when it asks. Then in GitHub open the repository → **Settings → Secrets and variables → Actions → New repository secret** and add four secrets:

| Name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the file as one line: `base64 -w0 saathi-release.jks` on Linux, `[Convert]::ToBase64String([IO.File]::ReadAllBytes("saathi-release.jks"))` in PowerShell |
| `ANDROID_KEYSTORE_PASSWORD` | the password |
| `ANDROID_KEY_ALIAS` | `saathi` |
| `ANDROID_KEY_PASSWORD` | the password |

Keep `saathi-release.jks` and its password backed up somewhere safe and offline, like the Saathi recovery key. If the key is lost, no future version can update the installed app. Never commit it; `.gitignore` already refuses `*.jks` files.

## Build it yourself

With Android Studio, or the Android SDK, JDK 17 and Gradle 8.11:

```
gradle -p android testDebugUnitTest lintRelease assembleDebug
```

The debug APK is in `android/app/build/outputs/apk/debug/`.
