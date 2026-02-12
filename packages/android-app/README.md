# Lotus Android App (Native Kotlin + Compose)

This package contains the native Android parity implementation for Lotus.

## Current Scope
- Compose app shell with unlock, vault, settings, sync, and security route shells.
- Peach theme system with dark/light support and fruit accents.
- Vault/crypto foundation (AES-GCM + AAD, integrity hash, migration snapshot support).
- Auth foundation (PIN, biometric capability checks, session grace semantics).
- Sync foundation (operation queue, timeline, three-way merge utility, server/S3 client shells).
- Native autofill service shell and URL/credential ranking utilities.
- TOTP manager and passkey manager wrappers.
- Import/export, pairing, and recovery helpers.

## Build
Use Android Studio (Koala or newer) and open this folder as a Gradle project:

- `packages/android-app/settings.gradle.kts`

Or via CLI if Gradle is installed:

- `gradle :app:assembleDebug`
- `gradle :app:testDebugUnitTest`

## Built-in updater
- The app includes an `Updates` tab that checks GitHub Releases for the latest Android build.
- It shows release notes in-app and supports one-tap `Download & Install` for the latest APK.
- Default release source is `june/Lotus` and can be overridden at build time:
  - `./gradlew :app:assembleRelease -PLOTUS_UPDATE_REPO=owner/repo`

## GitHub Actions release pipeline
- Workflow: `.github/workflows/android-release.yml`
- Trigger options:
  - Push a tag like `android-v0.2.0`
  - Run manually via `workflow_dispatch` and provide a tag
- Output:
  - Builds `app-release.apk`
  - Publishes release asset as `lotus-android-release.apk`
  - Publishes release notes (manual input or auto-generated from recent commits)
