# Lotus Android App - Implementation Status

## Overview
Complete rebuild of the Android app to achieve full feature parity with the browser extension.

## Completed Components

### 1. Build Configuration
**File:** `app/build.gradle.kts`
- Updated dependencies for AWS S3 SDK
- Added BouncyCastle for Argon2id
- Added OkHttp logging interceptor
- Configured packaging exclusions for BouncyCastle
- Added coroutines test dependency

### 2. GitHub Actions Workflow
**File:** `.github/workflows/android-release.yml`
Enhanced with:
- Automatic version code calculation from tags (android-vX.Y.Z)
- Gradle caching for faster builds
- APK signing support (using repository secrets)
- SHA256 checksum generation
- Comprehensive release notes
- Build artifact uploads

Required Secrets:
- `SIGNING_KEY` - Base64 encoded keystore
- `ALIAS` - Key alias
- `KEY_STORE_PASSWORD` - Keystore password
- `KEY_PASSWORD` - Key password

### 3. Crypto Engine
**File:** `app/src/main/java/com/lotus/android/core/crypto/CryptoEngine.kt`
Implemented:
- Argon2id KDF (256 MiB memory, 3 iterations, parallelism 4)
- HKDF for subkey derivation (vault-main, entry-{id}, settings)
- AES-GCM encryption/decryption with AAD binding
- IV collision detection for cross-device sync safety
- Secure memory wiping
- Vault header with KDF version tracking
- KDF migration support

## In Progress (Agent Implementation)

### 4. Vault Repository
Full vault management:
- Create/Unlock/Lock vault
- Entry CRUD (add, edit, soft delete, restore, permanent delete)
- Trash management with 30-day expiration
- Search with URL matching
- Vault integrity verification

### 5. Authentication Layer
- Master password unlock with Argon2id
- Biometric authentication (fingerprint/face)
- PIN code unlock with lockout protection
- Session management with auto-lock
- Secure key storage

### 6. S3 Synchronization
- Three-way merge algorithm
- Conflict detection and resolution
- Encrypted blob format matching extension
- ETag-based change detection
- Background sync

### 7. UI Layer
Matching extension design:
- Dark theme (#0a0a0f background)
- Peach/pink accent gradient
- Glass morphism cards
- Bottom navigation
- Entry list with type icons
- Entry detail with reveal/copy
- Trash management
- Settings with S3 config

### 8. Auto-Updater
- GitHub releases API integration
- Version comparison
- APK download with progress
- Install intent with proper permissions
- Release notes display

## Architecture Decisions

### Security
1. **Argon2id**: Industry-standard password hashing (OWASP recommended)
2. **AES-256-GCM**: Authenticated encryption
3. **HKDF**: Proper key derivation for subkeys
4. **IV Collision Detection**: Prevents catastrophic IV reuse in sync scenarios
5. **Memory Wiping**: Secure cleanup of sensitive data
6. **Hardware-backed Storage**: Android Keystore for biometric keys

### Compatibility
- Min SDK: 28 (Android 9.0)
- Target SDK: 35 (Android 15)
- Java 17
- Kotlin 1.9
- Jetpack Compose

### Sync
- S3-compatible endpoints (AWS, MinIO, etc.)
- Three-way merge for conflict resolution
- Encrypted payload format matching extension

## Next Steps

1. Wait for agent implementations to complete
2. Integrate all components
3. Add unit tests
4. Build and verify
5. Create signed release

## File Structure

```
packages/android-app/
├── app/
│   ├── build.gradle.kts          ✅ Updated
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml    ✅ Updated
│       │   ├── java/com/lotus/android/
│       │   │   ├── core/
│       │   │   │   ├── crypto/
│       │   │   │   │   ├── CryptoEngine.kt      ✅ Complete
│       │   │   │   │   ├── VaultHeader.kt       🔄 Agent
│       │   │   │   │   └── KdfMigration.kt      🔄 Agent
│       │   │   │   ├── repository/
│       │   │   │   │   ├── VaultRepository.kt   🔄 Agent
│       │   │   │   │   └── EntryRepository.kt   🔄 Agent
│       │   │   │   └── model/
│       │   │   │       └── VaultModels.kt       ✅ Exists
│       │   │   ├── auth/
│       │   │   │   ├── MasterKeyManager.kt      🔄 Agent
│       │   │   │   ├── BiometricAuthManager.kt  🔄 Agent
│       │   │   │   ├── PinManager.kt            🔄 Agent
│       │   │   │   └── SessionManager.kt        🔄 Agent
│       │   │   ├── sync/
│       │   │   │   ├── S3SyncClient.kt          🔄 Agent
│       │   │   │   ├── ThreeWayMerge.kt         🔄 Agent
│       │   │   │   └── SyncRepository.kt        🔄 Agent
│       │   │   ├── ui/
│       │   │   │   ├── theme/                   🔄 Agent
│       │   │   │   ├── screens/                 🔄 Agent
│       │   │   │   └── state/                   🔄 Agent
│       │   │   ├── update/
│       │   │   │   └── GithubUpdater.kt         🔄 Agent
│       │   │   └── MainActivity.kt
│       │   └── res/
│       └── test/
└── build.gradle.kts
```

## Building

### Debug Build
```bash
cd packages/android-app
./gradlew :app:assembleDebug
```

### Release Build
```bash
cd packages/android-app
./gradlew :app:assembleRelease
```

### With Custom Update Repo
```bash
./gradlew :app:assembleRelease -PLOTUS_UPDATE_REPO=owner/repo
```

## Releasing

### Automated (GitHub Actions)
1. Push a tag: `git tag android-v0.2.0 && git push origin android-v0.2.0`
2. GitHub Actions will build and create a release automatically

### Manual
1. Go to Actions → Android Release
2. Click "Run workflow"
3. Enter tag name (e.g., `android-v0.2.0`)
4. Optional: Add release notes

## Testing

### Unit Tests
```bash
./gradlew :app:testDebugUnitTest
```

### Instrumented Tests
```bash
./gradlew :app:connectedDebugAndroidTest
```

## Security Considerations

1. **Never commit keystores** - Use GitHub Secrets for signing
2. **ProGuard/R8** - Enable code obfuscation for release builds
3. **Root detection** - Consider adding SafetyNet/Play Integrity API
4. **Screenshot protection** - Add FLAG_SECURE to unlock screen
5. **Auto-lock** - Implement app lifecycle monitoring

## License
Same as the main Lotus project.
