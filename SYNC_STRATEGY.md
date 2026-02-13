# Peach Cross-Platform Sync Strategy

## Overview

This document outlines how to keep the **Android app** and **Chrome extension** in sync with each other. Since both platforms share the same vault format and encryption, they can use the same S3-compatible storage backend for synchronization.

## Architecture

```
┌──────────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Chrome Extension│◄────┤   S3 Cloud   ├────►│   Android App    │
│                  │     │   Storage    │     │                  │
│  - WebCrypto API │     │              │     │  - WebCrypto API │
│  - AES-256-GCM   │     │  Encrypted   │     │  - AES-256-GCM   │
│  - Argon2id KDF  │     │  Vault Blob  │     │  - Argon2id KDF  │
└──────────────────┘     └──────────────┘     └──────────────────┘
```

## Sync Mechanism

Both platforms use **identical sync logic**:

1. **Vault Encryption**: Both use AES-256-GCM with the same key derivation (Argon2id)
2. **Conflict Resolution**: Both use three-way merge for sync conflicts
3. **Sync Versioning**: Both use the same syncVersion counter
4. **S3 Protocol**: Both use AWS SDK v3 with identical object metadata

## Keeping Code in Sync

### Shared Code (`@lotus/shared`)

The following code is shared between both platforms via the `@lotus/shared` package:

```typescript
// packages/shared/src/
├── crypto.ts          # Encryption/decryption utilities
├── types.ts           # Vault and entry type definitions
├── merge.ts           # Three-way merge for conflicts
└── shamir.ts          # Secret sharing (future feature)
```

**When to update shared code:**
- Changes to encryption algorithms
- Changes to vault data structures
- Changes to conflict resolution logic

### Platform-Specific Code

#### Chrome Extension (`packages/extension/`)
- Content scripts for autofill
- Browser extension APIs (chrome.storage, chrome.runtime)
- Popup UI (React)

#### Android App (`packages/mobile/`)
- Capacitor plugins for native features
- Android Autofill Service
- Mobile-optimized UI (React)

## Sync Configuration

### S3 Settings (Both Platforms)

Both platforms use the same S3 configuration:

```typescript
interface S3Config {
  endpoint: string      // e.g., "s3.fr-par.scw.cloud"
  region: string        // e.g., "fr-par"
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}
```

### Sync Flow

1. **Save Operation** (on any platform):
   ```
   User saves entry
   ↓
   Encrypt vault with master key
   ↓
   Upload to S3 with syncVersion
   ↓
   Increment local syncVersion
   ```

2. **Sync Operation** (on any platform):
   ```
   Check S3 for newer syncVersion
   ↓
   If newer: download and decrypt
   ↓
   If conflict: three-way merge
   ↓
   Save merged vault
   ```

## Workflow for Updates

### Scenario 1: Chrome Extension Update

When updating the Chrome extension:

1. Update `packages/extension/src/`
2. If crypto/types changed, also update `packages/shared/src/`
3. Test sync with Android app
4. Release both simultaneously (or ensure backward compatibility)

### Scenario 2: Android App Update

When updating the Android app:

1. Update `packages/mobile/src/`
2. If crypto/types changed, also update `packages/shared/src/`
3. Test sync with Chrome extension
4. Release both simultaneously

### Scenario 3: Shared Code Update

When updating shared code:

1. Update `packages/shared/src/`
2. Test on BOTH platforms
3. Update both platforms' dependencies
4. Release both simultaneously

## Version Compatibility

### Current Versions

- **Vault Schema Version**: 2
- **KDF Version**: 2 (256 MiB Argon2id)
- **Sync Protocol Version**: 1

### Compatibility Rules

| Extension Version | Android Version | Compatible? |
|-------------------|-----------------|-------------|
| Same major version| Same major version| ✓ Yes       |
| Different major   | Any             | ✗ No        |

### Handling Breaking Changes

If you need to make breaking changes:

1. **Bump vault schema version** in both platforms
2. **Implement migration path** from old to new format
3. **Update sync protocol version** if needed
4. **Release both platforms together**

## Testing Sync

### Manual Testing Checklist

- [ ] Create entry in Chrome → Verify appears in Android
- [ ] Create entry in Android → Verify appears in Chrome
- [ ] Edit entry in Chrome → Verify updated in Android
- [ ] Edit entry in Android → Verify updated in Chrome
- [ ] Delete entry in Chrome → Verify removed in Android
- [ ] Delete entry in Android → Verify removed in Chrome
- [ ] Concurrent edits → Verify merge resolution
- [ ] Offline edits → Verify sync when reconnected

### Automated Testing

Consider adding E2E sync tests:

```typescript
// Pseudo-code for sync test
test('cross-platform sync', async () => {
  // Create entry in extension
  const entry = await extension.createEntry(testEntry);
  
  // Trigger sync on both platforms
  await extension.sync();
  await android.sync();
  
  // Verify entry exists in Android
  const androidEntry = await android.getEntry(entry.id);
  expect(androidEntry).toEqual(entry);
});
```

## Release Checklist

Before releasing updates:

- [ ] Test sync between latest Chrome extension and Android app
- [ ] Verify vault encryption/decryption works on both platforms
- [ ] Check S3 sync with real cloud provider (Scaleway/AWS)
- [ ] Test autofill on both platforms (Chrome content script, Android service)
- [ ] Verify biometric/PIN unlock on Android
- [ ] Test import/export compatibility

## Future Considerations

### Real-time Sync

Currently using polling-based sync. Future improvements:
- WebSocket signaling for real-time sync
- Push notifications for sync events

### P2P Sync

Planned feature for direct device-to-device sync without cloud:
- WebRTC data channels
- QR code pairing
- Same encryption, different transport

### Multi-device Support

As more platforms are added (iOS, Firefox, etc.):
- Maintain shared core library
- Platform-specific UI only
- Same S3 sync backend

## Summary

**Key Principles:**

1. **Share as much code as possible** via `@lotus/shared`
2. **Keep encryption identical** across all platforms
3. **Test sync before every release**
4. **Release platforms simultaneously** when making breaking changes
5. **Maintain backward compatibility** when possible

The current architecture ensures that:
- Both platforms use identical vault format
- Both platforms use identical sync protocol
- Updates to one platform don't break the other (within same version)
- Users can seamlessly switch between platforms
