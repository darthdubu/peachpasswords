# Peach - Project Status

## Overview
Peach (formerly Lotus) is a private, zero-knowledge password manager browser extension with LAN sync capabilities.

## Recent Changes

### Biometric Authentication (New)
- Touch ID / Face ID support via WebAuthn PRF

### QR Sync & Pairing (New)
- Bidirectional QR sync: phone can configure extension
- Unique cryptographically secure tokens per session
- Proper cleanup on cancel/unmount
- 5-minute TTL with auto-cleanup

### Crypto Key Handling (Fixed)
- Fixed key export error by storing raw Argon2 bytes

### PIN Unlock (New)
- 6-digit PIN unlock option as alternative to password
- PBKDF2 + AES-GCM encryption for PIN-encrypted master key
- Settings UI to enable/disable PIN
- Unlock screen supports both password and PIN modes

### UI Improvements
- Settings organized into categories (Appearance, Security, Sync, Backup, Import)
- Notes auto-display (no reveal button)
- Real QR codes with consistent styling
- Export filenames fixed to "peach"
- Hidden scrollbars globally (scroll functionality preserved)

