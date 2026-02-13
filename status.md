# Peach Password Manager - Project Status Report

**Generated:** 2026-02-12  
**Repository:** Lotus/Peach Password Manager  
**Project Type:** Zero-Knowledge Browser Extension Password Manager

---

## Executive Summary

Peach (also referred to as Lotus) is a **zero-knowledge password manager** implemented as a browser extension with S3 cloud synchronization and planned peer-to-peer (P2P) device pairing capabilities. The project emphasizes client-side encryption with no server access to decrypted data.

**Current Maturity:** Beta/Pre-production  
**Security Audit Status:** Recently completed (24-agent distributed analysis) - Grade: B+  
**Overall Health:** Solid cryptographic foundation with identified areas for improvement

---

## Tech Stack

### Core Technologies

| Component | Technology | Version/Notes |
|-----------|------------|---------------|
| **Language** | TypeScript | 5.3.3 |
| **Build Tool** | Vite | 5.1.4 |
| **Frontend Framework** | React | 18.2.0 |
| **UI Styling** | Tailwind CSS | 3.4.1 |
| **Animation** | Framer Motion | 11.18.2 |
| **Icons** | Lucide React | 0.344.0 |
| **Browser Extension** | Manifest V3 | Chrome/Edge compatible |

### Cryptographic Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **KDF** | Argon2id (via hash-wasm) | Password-derived key generation |
| **Encryption** | AES-256-GCM | Vault and entry encryption |
| **Key Derivation** | HKDF-SHA256 | Sub-key derivation from master key |
| **Signing** | Ed25519 | Device identity and authentication |
| **Key Agreement** | X25519 | Planned for P2P Noise Protocol |
| **Hashing** | SHA-256 | Integrity verification |

### Backend/Server Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Runtime** | Node.js | Server runtime |
| **Framework** | Fastify | 4.26.2 |
| **Database** | SQLite3 | Device pairing and signaling state |
| **Real-time** | @fastify/websocket | Signaling for P2P |
| **Security** | TLS 1.3 (mandatory) | mTLS for client auth |
| **Rate Limiting** | @fastify/rate-limit | DDoS protection |

### Cloud Infrastructure

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Object Storage** | AWS S3 / Compatible | Encrypted vault sync |
| **SDK** | @aws-sdk/client-s3 | 3.986.0 |

### Testing Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Unit Testing** | Vitest | 1.3.0 |
| **E2E Testing** | Playwright | 1.42.0 |
| **Property Testing** | fast-check | 4.5.3 |

---

## Project Structure

### Monorepo Layout

```
/Users/june/projects/Lotus/
├── package.json                    # Root workspace configuration
├── packages/
│   ├── extension/                  # Browser extension (main product)
│   │   ├── public/
│   │   │   ├── manifest.json       # Extension manifest v3
│   │   │   ├── popup.html          # Popup entry point
│   │   │   ├── background.js       # Service worker (built)
│   │   │   ├── content.js          # Content script (built)
│   │   │   └── icons/              # Extension icons
│   │   ├── src/
│   │   │   ├── popup/              # Popup UI application
│   │   │   │   ├── App.tsx         # Main popup component
│   │   │   │   ├── main.tsx        # Popup entry point
│   │   │   │   ├── contexts/       # React contexts
│   │   │   │   │   ├── VaultContext.tsx
│   │   │   │   │   └── ThemeContext.tsx
│   │   │   │   ├── components/     # UI components
│   │   │   │   │   ├── VaultList.tsx
│   │   │   │   │   ├── EntryDetail.tsx
│   │   │   │   │   ├── EntryForm.tsx
│   │   │   │   │   ├── Settings.tsx
│   │   │   │   │   ├── UnlockScreen.tsx
│   │   │   │   │   └── ui/         # Reusable UI primitives
│   │   │   │   │       ├── button.tsx
│   │   │   │   │       ├── input.tsx
│   │   │   │   │       ├── card.tsx
│   │   │   │   │       └── ...
│   │   │   │   └── hooks/          # Custom React hooks
│   │   │   │       ├── useS3Sync.ts
│   │   │   │       └── useSync.ts
│   │   │   ├── background/         # Service worker
│   │   │   │   └── service-worker.ts
│   │   │   ├── content/            # Content scripts
│   │   │   │   ├── autofill.ts     # Form autofill logic
│   │   │   │   ├── autofill-styles.ts
│   │   │   │   └── passkey-inject.ts
│   │   │   ├── lib/                # Core library code
│   │   │   │   ├── crypto.ts       # WebCrypto operations
│   │   │   │   ├── crypto-utils.ts # Crypto utilities
│   │   │   │   ├── crypto-worker-client.ts
│   │   │   │   ├── vault-version.ts
│   │   │   │   ├── types.ts        # Extension types
│   │   │   │   ├── pin.ts          # PIN authentication
│   │   │   │   ├── biometric.ts    # WebAuthn/biometric
│   │   │   │   ├── pairing.ts      # P2P pairing
│   │   │   │   ├── totp.ts         # TOTP generation
│   │   │   │   ├── password-generator.ts
│   │   │   │   ├── three-way-merge.ts
│   │   │   │   ├── sync-*.ts       # Sync operations
│   │   │   │   └── ...
│   │   │   ├── workers/            # Web Workers
│   │   │   │   └── crypto-worker.ts
│   │   │   └── types/              # Type definitions
│   │   ├── docs/
│   │   │   └── P2P-SYNC-DESIGN.md  # P2P architecture design
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   ├── server/                     # Signaling/pairing server
│   │   ├── src/
│   │   │   ├── index.ts            # Server entry point
│   │   │   ├── routes/
│   │   │   │   ├── vault.ts
│   │   │   │   ├── sync.ts
│   │   │   │   ├── pairing.ts
│   │   │   │   └── health.ts
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts
│   │   │   ├── storage/
│   │   │   │   └── sqlite.ts
│   │   │   └── lib/
│   │   │       ├── config.ts
│   │   │       ├── types.ts
│   │   │       └── events.ts
│   │   └── package.json
│   │
│   └── shared/                     # Shared code between packages
│       ├── src/
│       │   ├── index.ts            # Public exports
│       │   ├── types.ts            # Shared type definitions
│       │   ├── crypto.ts           # Shared crypto utilities
│       │   ├── merge.ts            # Conflict resolution
│       │   └── shamir.ts           # Secret sharing
│       └── package.json
│
└── packages/audit211.md            # Recent security audit report
```

---

## Feature Set

### Implemented Features

#### Core Password Management
- ✅ **Vault Management**: Create, read, update, delete password entries
- ✅ **Entry Types**:
  - Login credentials (username/password)
  - Credit cards (encrypted storage)
  - Secure notes
  - Identity information
  - TOTP (Time-based One-Time Password)
  - Passkeys (WebAuthn credential storage)
- ✅ **Folder Organization**: Basic folder support
- ✅ **Favorites**: Mark entries as favorites for quick access
- ✅ **Trash/Soft Delete**: Entries moved to trash with expiration

#### Security Features
- ✅ **Zero-Knowledge Architecture**: Client-side only encryption
- ✅ **Argon2id KDF**: Memory-hard password derivation (64 MiB, 3 iterations)
- ✅ **AES-256-GCM**: Authenticated encryption for all vault data
- ✅ **IV Collision Detection**: Prevents IV reuse across device sync
- ✅ **Vault Integrity**: SHA-256 content hash verification
- ✅ **PIN Protection**: Alternative unlock with rate limiting
- ✅ **Biometric Unlock**: WebAuthn/platform authenticator support
- ✅ **Auto-lock**: Configurable timeout-based vault locking
- ✅ **Secure Memory Wiping**: Best-effort memory zeroization

#### Sync & Backup
- ✅ **S3 Cloud Sync**: Compatible with AWS S3, Wasabi, DigitalOcean Spaces, etc.
- ✅ **Conflict Resolution**: Three-way merge for sync conflicts
- ✅ **Sync Observability**: Event logging for sync operations
- ✅ **Import/Export**: CSV import, encrypted vault export
- ✅ **Recovery**: Recovery key generation and restoration

#### Browser Integration
- ✅ **Autofill**: Automatic form detection and filling
- ✅ **Password Generation**: Configurable password generator
- ✅ **Context Menu**: Right-click to fill passwords
- ✅ **Passkey Support**: Store and use WebAuthn credentials
- ✅ **Shadow DOM Piercing**: Works with modern web components

#### UI/UX
- ✅ **Dark Theme**: Polished dark UI with Tailwind
- ✅ **Responsive Design**: 600x420 popup window
- ✅ **Animations**: Smooth transitions with Framer Motion
- ✅ **Accessibility**: Keyboard navigation support
- ✅ **Search**: Real-time entry filtering

### Planned/Incomplete Features

#### P2P Synchronization (Priority: High)
- 🔄 **WebRTC Data Channels**: Device-to-device sync without cloud
- 🔄 **Noise Protocol XX**: End-to-end encryption with mutual auth
- 🔄 **QR Code Pairing**: Easy device pairing via QR codes
- 🔄 **LAN Discovery**: Local network device discovery
- 📄 **Status**: Design complete (see `P2P-SYNC-DESIGN.md`), implementation pending

#### Security Hardening (Priority: Critical)
- ⚠️ **Argon2id Memory Increase**: From 64 MiB to 256 MiB
- ⚠️ **XSS Fixes**: Replace innerHTML with DOM API in autofill
- ⚠️ **Biometric Verification**: Change from 'preferred' to 'required'
- ⚠️ **Constant-Time Comparisons**: For HMAC/integrity verification

#### Additional Features
- 🔮 **Mobile Apps**: Planned Android/iOS companions
- 🔮 **Browser Extension Port**: Firefox support
- 🔮 **Security Audit Logging**: Comprehensive event tracking
- 🔮 **Password Health**: Reuse and weakness detection
- 🔮 **Breach Monitoring**: Integration with breach databases

---

## Architecture Overview

### Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Popup UI   │  │ Content Script│  │   Service Worker     │  │
│  │   (React)    │  │  (Autofill)   │  │  (Background Sync)   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                     │              │
│         └─────────────────┼─────────────────────┘              │
│                           │                                    │
│                    ┌──────▼──────┐                            │
│                    │ Vault State │                            │
│                    │  (Context)  │                            │
│                    └──────┬──────┘                            │
│                           │                                    │
│         ┌─────────────────┼─────────────────┐                  │
│         │                 │                 │                  │
│    ┌────▼────┐      ┌─────▼─────┐    ┌──────▼──────┐          │
│    │ Crypto  │      │   Sync    │    │  Storage    │          │
│    │  Layer  │      │  Engine   │    │  (chrome)   │          │
│    └────┬────┘      └─────┬─────┘    └─────────────┘          │
│         │                 │                                    │
│    ┌────▼────────────────▼────┐                               │
│    │     Encryption Flow      │                               │
│    │  Argon2id → AES-256-GCM  │                               │
│    └──────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS/TLS 1.3
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SERVER                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Fastify + WebSocket                                       │  │
│  │  - Pairing/signaling only                                  │  │
│  │  - No vault data access                                     │  │
│  │  - mTLS client authentication                              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    S3-COMPATIBLE STORAGE                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Encrypted Vault Blob                                      │  │
│  │  - Zero-knowledge: Provider sees only ciphertext           │  │
│  │  - Client-side encryption only                             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Vault Unlock**: Master password → Argon2id → AES-256-GCM key
2. **Entry Encryption**: Entry data → AES-GCM (key derived per entry)
3. **Sync**: Encrypted vault → S3 PUT/GET (no server involvement)
4. **Conflict Resolution**: Three-way merge using sync version
5. **Autofill**: Content script detects forms → Requests decryption → Fills fields

---

## Dependencies & External Libraries

### Extension Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @aws-sdk/client-s3 | ^3.986.0 | S3 API client |
| @radix-ui/* | various | Accessible UI primitives |
| framer-motion | ^11.18.2 | Animations |
| hash-wasm | ^4.12.0 | Argon2id WASM implementation |
| jszip | ^3.10.1 | ZIP export/import |
| lucide-react | ^0.344.0 | Icons |
| papaparse | ^5.5.3 | CSV parsing |
| react | ^18.2.0 | UI framework |
| react-qr-code | ^2.0.18 | QR code generation |
| tailwindcss | ^3.4.1 | CSS framework |

### Server Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| fastify | ^4.26.2 | Web framework |
| @fastify/cors | ^9.0.1 | CORS handling |
| @fastify/rate-limit | ^9.1.0 | Rate limiting |
| @fastify/websocket | ^10.0.1 | WebSocket support |
| sqlite3 | ^5.1.7 | Database |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| typescript | ^5.3.3 | Type checking |
| vite | ^5.1.4 | Build tool |
| vitest | ^1.3.0 | Unit testing |
| @playwright/test | ^1.42.0 | E2E testing |
| eslint | ^8.56.0 | Linting |
| tailwindcss | ^3.4.1 | CSS framework |

---

## Configuration

### Build Configuration

**Extension (`vite.config.ts`)**:
- Multiple entry points: popup, background, content
- WASM support for Argon2
- Top-level await support

**TypeScript**:
- Strict mode enabled
- Path mapping: `@/*` → `src/*`

### Extension Manifest

```json
{
  "manifest_version": 3,
  "name": "Peach",
  "version": "1.0.1",
  "permissions": [
    "storage",
    "activeTab",
    "alarms",
    "clipboardWrite"
  ],
  "host_permissions": ["<all_urls>"]
}
```

### Environment Variables

**Server**:
- `VAULTKEY_CERTS`: TLS certificate directory
- `PORT`: Server port (default: 3000)

---

## Testing Strategy

### Current Test Coverage

| Test Type | Framework | Files |
|-----------|-----------|-------|
| Unit Tests | Vitest | `*.test.ts` |
| Property Tests | fast-check | `crypto-property.test.ts` |
| E2E Tests | Playwright | `*.spec.ts` |

### Key Test Files

- `src/lib/crypto.test.ts` - Core crypto operations
- `src/lib/crypto-utils.test.ts` - Crypto utilities
- `src/lib/crypto-property.test.ts` - Property-based testing
- `src/lib/sync-ops.test.ts` - Sync operations
- `src/lib/migration.test.ts` - Vault migrations
- `src/lib/pin.test.ts` - PIN authentication

### Testing Gaps

- 🔄 E2E tests for full sync flows
- 🔄 Integration tests for S3 operations
- 🔄 Security regression tests

---

## Security Assessment

### Recent Audit Findings (2026-02-11)

**Overall Grade: B+**

#### Strengths
- ✅ True Zero-Knowledge architecture maintained
- ✅ Proper WebCrypto API usage with non-extractable keys
- ✅ Industry-standard primitives (Argon2id, AES-256-GCM)
- ✅ Rate limiting on PIN attempts
- ✅ Vault integrity verification

#### Critical Issues (Must Fix Before Production)
1. **XSS-001**: `innerHTML` usage in autofill.ts allows script injection
2. **BIO-001**: Biometric `userVerification: 'preferred'` allows fallback to no verification
3. **KDF-001**: Argon2id memory (64 MiB) insufficient against GPU attacks

#### High Priority Issues
1. **META-001**: S3 object metadata leaks sync version and access patterns
2. **TIME-001**: Non-constant-time comparison for vault integrity
3. **TOCTOU-001**: Autofill vulnerable to prototype pollution attacks

### Threat Model

**Assets Protected:**
- Vault data (encrypted passwords, notes, cards)
- Session content during sync
- Device identity keys
- Pairing relationships

**Trust Assumptions:**
- Device secure storage (keychain/keystore) is secure
- Platform CSPRNG is secure
- Pairing exchange happened without interception
- WebRTC DTLS implementation is secure

**Not Protected Against:**
- Compromised endpoint devices
- Shoulder surfing during pairing
- Social engineering attacks
- Side-channel attacks (JavaScript limitations)

---

## Development Workflow

### Scripts

**Root:**
```bash
npm run build    # Build all packages
npm run test     # Run all tests
npm run lint     # Lint all packages
```

**Extension:**
```bash
npm run dev          # Development server
npm run build        # Production build
npm run test         # Unit tests
npm run test:e2e     # Playwright E2E tests
```

**Server:**
```bash
npm run build        # Compile TypeScript
npm run start        # Start server
```

### Code Quality

- **ESLint**: TypeScript and React rules
- **TypeScript**: Strict mode
- **Prettier**: Not currently configured (consider adding)

---

## Known Issues & Limitations

### JavaScript Limitations
- **Memory Safety**: Garbage collector prevents true secure erasure
- **Timing Attacks**: JavaScript timing is not constant-time
- **Spectre/Meltdown**: WebCrypto operations vulnerable to speculative execution

### Browser Extension Constraints
- **Content Security Policy**: `'wasm-unsafe-eval'` required for Argon2
- **Host Permissions**: `<all_urls>` required for autofill (privacy concern)
- **Storage Limits**: chrome.storage.local quota limitations

### Sync Limitations
- **P2P Incomplete**: WebRTC + Noise Protocol implementation pending
- **S3 Metadata Leak**: Version info visible in object metadata
- **Conflict UI**: Basic conflict resolution interface

---

## Recommendations for Refactoring Team

### Priority 1: Security Hardening

1. **Fix XSS Vulnerabilities**
   - Replace all `innerHTML` with DOM API in `src/content/autofill.ts`
   - Sanitize any user-generated content before DOM insertion

2. **Harden Biometric Authentication**
   - Change `userVerification: 'preferred'` to `'required'` in `src/lib/biometric.ts`

3. **Increase KDF Strength**
   - Implement migration path from 64 MiB to 256 MiB Argon2id
   - Maintain backward compatibility during migration

### Priority 2: Code Quality

1. **Add Constant-Time Comparisons**
   - Implement `constantTimeEqual()` for all integrity checks
   - Use in `verifyVaultIntegrity()` function

2. **Remove S3 Metadata Leaks**
   - Remove `Metadata` field from S3 PUT operations
   - Move version inside encrypted blob

3. **Add Input Validation**
   - Validate all user inputs at API boundaries
   - Add schema validation for imported data

### Priority 3: Testing

1. **Increase Test Coverage**
   - Add integration tests for sync flows
   - Add property-based tests for merge logic
   - Add security regression tests

2. **Add E2E Tests**
   - Full vault lifecycle (create, edit, delete)
   - Sync conflict resolution
   - Import/export flows

### Priority 4: Documentation

1. **API Documentation**
   - Document all public functions in `lib/`
   - Add JSDoc comments

2. **Security Documentation**
   - Document threat model
   - Add security considerations to README

---

## Deployment Considerations

### Extension Distribution
- Chrome Web Store submission pending
- Firefox Add-ons (port required)
- Edge Add-ons (Chrome-compatible)

### Server Deployment
- **Requirement**: Valid TLS certificates (mTLS)
- **Scripts**: `scripts/generate-certs.sh` for development
- **Production**: Use proper CA-signed certificates

### S3 Configuration
- **Bucket Policy**: Block public access
- **CORS**: Configure for extension origin
- **Encryption**: Client-side only (maintain ZK)

---

## Contacts & Resources

### Key Documents
- `P2P-SYNC-DESIGN.md` - P2P architecture specification
- `audit211.md` - Comprehensive security audit report

### Related Standards
- WebCrypto API
- WebAuthn / FIDO2
- Noise Protocol Framework
- Argon2 RFC 9106

---

## Appendix: File Inventory

### Source Files (67 in extension)

**Core Library (`src/lib/`):**
- `crypto.ts` - WebCrypto operations, IV collision detection
- `crypto-utils.ts` - Encoding, secure wipe utilities
- `crypto-worker-client.ts` - Web Worker interface
- `types.ts` - TypeScript definitions
- `vault-version.ts` - KDF versioning
- `sync-*.ts` - Sync operations, conflicts, types
- `three-way-merge.ts` - Conflict resolution
- `pin.ts` - PIN authentication with rate limiting
- `biometric.ts` - WebAuthn integration
- `pairing.ts` - P2P pairing logic
- `totp.ts` - TOTP generation
- `password-generator.ts` - Password generation
- `security-events.ts` - Audit logging
- `security-score.ts` - Password health
- `url-matching.ts` - URL pattern matching
- `importers.ts` - CSV import
- `recovery.ts` - Recovery keys

**UI Components (`src/popup/components/`):**
- `App.tsx` - Main application
- `VaultList.tsx` - Entry list view
- `EntryDetail.tsx` - Entry details
- `EntryForm.tsx` - Create/edit entries
- `Settings.tsx` - Settings panel
- `UnlockScreen.tsx` - Vault unlock
- `icons.tsx` - Icon components
- `ui/*` - Reusable UI primitives

**Contexts (`src/popup/contexts/`):**
- `VaultContext.tsx` - Vault state management
- `ThemeContext.tsx` - Theme management

**Scripts:**
- `service-worker.ts` - Background script
- `autofill.ts` - Content script for form filling
- `passkey-inject.ts` - Passkey support

**Workers:**
- `crypto-worker.ts` - Isolated crypto operations

---

*End of Status Report*
