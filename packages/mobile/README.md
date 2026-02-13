# Peach Mobile - Hybrid Capacitor + Native Android App

This is a hybrid mobile implementation of Peach Passwords using CapacitorJS with a native Android Autofill Service.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CAPACITOR LAYER                          │
├─────────────────────────────────────────────────────────────┤
│  React/TypeScript UI (ported from browser extension)        │
│  - Vault Management                                         │
│  - Entry CRUD                                               │
│  - Settings & Sync                                          │
│  - WebCrypto operations                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Capacitor Bridge
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              NATIVE ANDROID LAYER                           │
├─────────────────────────────────────────────────────────────┤
│  PeachAutofillService (extends AutofillService)             │
│  - Handles Android system autofill requests                 │
│  - Shows inline unlock dialog when vault locked             │
│  - Fills credentials in any app                             │
│                                                             │
│  PeachVaultPlugin (Capacitor Plugin)                        │
│  - Bridges vault operations between web and native          │
│  - Manages encrypted vault storage                          │
│  - Handles biometric authentication                         │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

### Autofill Service (Option B - Inline Unlock)

When the user focuses a username/password field in any Android app:

1. Android calls `PeachAutofillService.onFillRequest()`
2. Service parses the app structure to find login fields
3. If vault is unlocked:
   - Returns matching credentials as autofill datasets
   - User taps credential → fields are filled
4. If vault is locked:
   - Returns unlock dataset with authentication intent
   - User taps "Unlock Peach Vault" → UnlockActivity opens
   - User enters password → vault unlocks
   - Returns to autofill with credentials available

### Data Flow

**Vault Creation/Unlock (Capacitor):**
```
User enters password in React UI
    ↓
WebCrypto derives key via Argon2id (WASM)
    ↓
Encrypted vault stored via Capacitor Preferences
    ↓
Vault state synced to native VaultStorage
```

**Autofill Request (Native):**
```
User focuses login field in Chrome/Twitter/etc
    ↓
Android calls PeachAutofillService.onFillRequest()
    ↓
Service queries VaultStorage for credentials
    ↓
If locked: Show unlock prompt
If unlocked: Show matching credentials
    ↓
User selects credential → fields filled
```

## File Structure

```
packages/mobile/
├── src/
│   ├── popup/              # React UI components
│   │   ├── components/     # VaultList, EntryForm, Settings, etc.
│   │   ├── contexts/       # VaultContext, ThemeContext
│   │   └── hooks/          # Custom React hooks
│   ├── lib/                # Shared utilities
│   │   ├── storage.ts      # Capacitor storage wrapper
│   │   ├── crypto.ts       # Crypto re-exports
│   │   └── constants.ts    # App constants
│   ├── android-plugin/     # Capacitor plugin
│   │   ├── peachvault.ts   # TypeScript definitions
│   │   └── peachvault/src/main/java/com/peach/plugin/
│   │       ├── PeachAutofillService.kt
│   │       ├── PeachVaultPlugin.kt
│   │       ├── VaultStorage.kt
│   │       └── UnlockActivity.kt
│   └── main.tsx            # Entry point
├── capacitor.config.ts     # Capacitor configuration
├── vite.config.ts          # Vite build config
└── package.json
```

## Setup

### Prerequisites
- Node.js 18+
- Java 21 (required for Android build)
- Android SDK (via Android Studio)

1. Install dependencies:
```bash
cd packages/mobile
npm install
```

2. Add Android platform:
```bash
npx cap add android
```

3. Copy native plugin files:
```bash
# The plugin files are automatically copied during the build process
# Manual copy if needed:
cp src/android-plugin/peachvault/src/main/java/com/peach/plugin/*.kt android/app/src/main/java/com/peach/plugin/
```

4. Sync Capacitor:
```bash
npm run sync
```

5. Build and run:
```bash
npm run android
```

### Building APK

**Debug APK:**
```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
cd android
./gradlew assembleDebug
```

APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

**Release APK:**
```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
cd android
./gradlew assembleRelease
```

APK location: `android/app/build/outputs/apk/release/app-release.apk`

### Pre-built APK

A debug APK has been built and is available at:
`/artifacts/peach-android-debug.apk`

**Note:** The app is named "Peach" (not Lotus) as requested.

## Android Manifest Configuration

The `android/app/src/main/AndroidManifest.xml` needs these additions:

```xml
<application ...>
    <!-- Main activity -->
    <activity ...>
        ...
    </activity>
    
    <!-- Autofill Service -->
    <service
        android:name="com.peach.plugin.PeachAutofillService"
        android:permission="android.permission.BIND_AUTOFILL_SERVICE"
        android:exported="true">
        <intent-filter>
            <action android:name="android.service.autofill.AutofillService" />
        </intent-filter>
        <meta-data
            android:name="android.autofill"
            android:resource="@xml/peach_autofill_service" />
    </service>
    
    <!-- Unlock Activity -->
    <activity
        android:name="com.peach.plugin.UnlockActivity"
        android:theme="@style/Theme.AppCompat.Light.Dialog"
        android:exported="false"
        android:excludeFromRecents="true"
        android:taskAffinity="" />
</application>
```

## Capacitor Plugin API

```typescript
// Check if vault is unlocked
const { unlocked } = await PeachVault.isVaultUnlocked()

// Unlock vault
const { success, error } = await PeachVault.unlockVault({ password })

// Get autofill data for package
const { credentials } = await PeachVault.getAutofillData({ packageName: 'com.twitter.android' })

// Lock vault
await PeachVault.lockVault()

// Biometric
const { available } = await PeachVault.hasBiometric()
const { success } = await PeachVault.authenticateWithBiometric()
```

## Security Considerations

1. **Vault Encryption**: Uses same Argon2id + AES-256-GCM as browser extension
2. **Memory Safety**: Decrypted vault only held in memory, never persisted plaintext
3. **Autofill Isolation**: Autofill service runs in separate process, communicates via binder
4. **Biometric**: Uses Android Keystore + BiometricPrompt for secure key storage
5. **Autofill Trust**: Only fills apps that match stored URL patterns

## Known Limitations

1. **WebCrypto in WebView**: Uses WebView's WebCrypto implementation (secure)
2. **Autofill Discovery**: Relies on app's autofill hints (some apps don't provide them)
3. **Inline Unlock**: Requires separate unlock activity (Android limitation)
4. **Background Sync**: S3 sync only happens when app is open (Capacitor limitation)

## Future Enhancements

1. Native crypto implementation for faster operations
2. Background sync via WorkManager
3. Inline biometric prompt in autofill flow
4. Passkey support via Credential Manager
5. Accessibility service fallback for apps without autofill support
