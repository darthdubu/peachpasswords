# VaultKey — Private Password Manager

A zero-knowledge, self-hosted password manager built as a browser extension with LAN server sync and Google Drive backup.

---

## Project Overview

VaultKey is a privacy-first password manager designed to give you complete ownership of your credentials. Unlike cloud-dependent managers like Proton Pass or Bitwarden, VaultKey keeps your encrypted vault on your own infrastructure — a local server on your network — with an optional encrypted Google Drive backup for resilience.

### Core Principles

- **Zero-knowledge architecture.** The server never sees plaintext. All encryption and decryption happens exclusively on the client (browser extension). The server stores and syncs opaque encrypted blobs.
- **Local-first.** Your vault lives on your LAN. No third-party cloud dependency for primary operation.
- **Resilient backup.** Google Drive integration provides an encrypted backup layer if your server goes offline.
- **Full credential support.** Passwords, TOTP 2FA codes, and passkeys (WebAuthn) — no artificial feature gates.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │   Laptop    │  │   Phone     │  │  Desktop    │      │
│  │  Browser    │  │  Firefox    │  │  Browser    │      │
│  │  Extension  │  │  Android    │  │  Extension  │      │
│  │             │  │  Extension  │  │             │      │
│  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │      │
│  │ │ Crypto  │ │  │ │ Crypto  │ │  │ │ Crypto  │ │      │
│  │ │ Engine  │ │  │ │ Engine  │ │  │ │ Engine  │ │      │
│  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │                │                │              │
└─────────┼────────────────┼────────────────┼──────────────┘
          │                │                │
          │         LAN (mTLS)              │
          │                │                │
┌─────────┼────────────────┼────────────────┼──────────────┐
│         └────────────────┼────────────────┘              │
│                    ┌─────┴─────┐                         │
│                    │  SERVER   │                         │
│                    │  VaultKey │         SERVER LAYER     │
│                    │  Sync     │                         │
│                    │  Service  │                         │
│                    └─────┬─────┘                         │
│                          │                               │
│                ┌─────────┴─────────┐                     │
│                │                   │                     │
│          ┌─────┴─────┐     ┌──────┴──────┐               │
│          │  Encrypted │     │  Google     │               │
│          │  Vault     │     │  Drive      │               │
│          │  Storage   │     │  Backup     │               │
│          │  (disk)    │     │  (encrypted)│               │
│          └───────────┘     └─────────────┘               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

1. User unlocks the extension with their master password.
2. The extension derives an encryption key locally using Argon2id.
3. All vault operations (read, write, search) happen on decrypted data in memory on the client.
4. When the vault changes, the extension re-encrypts the entire vault and pushes the encrypted blob to the server via a REST API over mTLS.
5. Other connected clients receive a sync notification (via WebSocket) and pull the latest encrypted blob.
6. Periodically (or on each write), the server also pushes the encrypted blob to Google Drive as a backup.

---

## Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| Browser Extension | TypeScript, React 18, Vite | Modern DX, fast builds, type safety |
| UI Framework | shadcn/ui + Tailwind CSS | Sleek, minimal, accessible components |
| Extension Framework | WebExtension API (Manifest V3) | Cross-browser (Chrome, Firefox, Edge) |
| Crypto (client) | Web Crypto API + argon2-browser | Native browser crypto, Argon2id for KDF |
| Server | Node.js + Express/Fastify | Shares TypeScript with the extension |
| Server Storage | SQLite (via better-sqlite3) | Lightweight, zero-config, single-file DB |
| Server ↔ Client | REST API + WebSocket (over TLS) | Sync pushes + real-time notifications |
| Google Drive | Google Drive API v3 | Encrypted backup of the vault blob |
| Passkeys | WebAuthn API | Native browser passkey support |

---

## Detailed Component Specifications

### 1. Cryptographic Layer

This is the most critical component. Every design decision here prioritizes security.

#### Key Derivation

```
Master Password
      │
      ▼
┌─────────────┐
│  Argon2id   │  Parameters:
│             │    memory:  64 MiB
│             │    iterations: 3
│             │    parallelism: 4
│             │    salt: 32 bytes (random, stored with vault)
│             │    output: 32 bytes
└──────┬──────┘
       │
       ▼
  Master Key (256-bit)
       │
       ├──► Vault Encryption Key (HKDF-SHA256, info="vault-encryption")
       │
       └──► Auth Key (HKDF-SHA256, info="server-auth")
```

- **Argon2id** is used because it resists both GPU attacks (memory-hard) and side-channel attacks (hybrid design). PBKDF2 and bcrypt are significantly weaker for this use case.
- **HKDF** derives separate sub-keys so the encryption key and the server authentication key are cryptographically independent. Compromising one does not reveal the other.
- The **salt** is unique per vault and stored unencrypted alongside the vault. It is not secret — its purpose is to prevent precomputed attacks.

#### Vault Encryption

```
Vault Data (JSON)
      │
      ▼
┌─────────────┐
│  AES-256-   │  IV: 12 bytes (random per encryption)
│  GCM        │  AAD: vault version + timestamp
│             │  Tag: 128-bit (authentication)
└──────┬──────┘
       │
       ▼
  Encrypted Vault Blob
  ┌──────────────────────────────────┐
  │ version │ salt │ IV │ ciphertext │ tag │
  │  (2B)   │(32B) │(12B)│  (var)    │(16B)│
  └──────────────────────────────────┘
```

- **AES-256-GCM** provides both confidentiality and integrity (authenticated encryption). Any tampering with the ciphertext is detected.
- A **fresh IV** is generated for every encryption operation. AES-GCM requires unique IVs; reuse is catastrophic.
- **Additional Authenticated Data (AAD)** binds the vault version and timestamp to the ciphertext, preventing downgrade or replay attacks.

#### Per-Entry Encryption (Defense in Depth)

While the vault is encrypted as a whole, sensitive fields within each entry are also individually encrypted with entry-specific keys derived from the master key:

```
Master Key + Entry UUID ──► HKDF ──► Entry Key
Entry Key + AES-256-GCM ──► Encrypted password / TOTP secret / passkey private key
```

This means even if memory is dumped while the vault is unlocked, individual secrets require their own decryption step.

#### Security Constraints

- The master password and master key **never leave the client**. They are never transmitted to the server.
- The server's **Auth Key** (derived from master key) is used to authenticate API requests via HMAC. The server can verify the client's identity without ever learning the master password.
- The vault is locked (keys zeroed from memory) after a configurable idle timeout (default: 5 minutes).
- Clipboard is auto-cleared after 30 seconds when copying passwords.

---

### 2. Browser Extension

#### Manifest V3 Structure

```
vaultkey-extension/
├── manifest.json              # Extension manifest (V3)
├── src/
│   ├── popup/                 # Main popup UI
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── components/
│   │       ├── UnlockScreen.tsx
│   │       ├── VaultList.tsx
│   │       ├── EntryDetail.tsx
│   │       ├── EntryForm.tsx
│   │       ├── TOTPDisplay.tsx
│   │       ├── PasskeyManager.tsx
│   │       ├── PasswordGenerator.tsx
│   │       ├── Settings.tsx
│   │       └── ui/            # shadcn/ui components
│   │           ├── button.tsx
│   │           ├── input.tsx
│   │           ├── card.tsx
│   │           ├── dialog.tsx
│   │           ├── toast.tsx
│   │           ├── tabs.tsx
│   │           ├── badge.tsx
│   │           ├── switch.tsx
│   │           ├── dropdown-menu.tsx
│   │           └── scroll-area.tsx
│   ├── background/
│   │   ├── service-worker.ts  # Background service worker
│   │   ├── crypto.ts          # Crypto engine (Argon2, AES-GCM, HKDF)
│   │   ├── vault.ts           # Vault CRUD operations
│   │   ├── sync.ts            # Server sync client
│   │   ├── gdrive.ts          # Google Drive backup client
│   │   ├── totp.ts            # TOTP generation (RFC 6238)
│   │   └── passkeys.ts        # WebAuthn credential management
│   ├── content/
│   │   ├── autofill.ts        # Form detection and autofill
│   │   └── passkey-inject.ts  # WebAuthn request interception
│   ├── lib/
│   │   ├── crypto-utils.ts    # Low-level crypto helpers
│   │   ├── types.ts           # TypeScript interfaces
│   │   └── constants.ts       # Configuration constants
│   └── styles/
│       └── globals.css        # Tailwind + shadcn theme
├── public/
│   └── icons/                 # Extension icons (16, 32, 48, 128)
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

#### manifest.json

```json
{
  "manifest_version": 3,
  "name": "VaultKey",
  "version": "1.0.0",
  "description": "Private, zero-knowledge password manager with LAN sync",
  "permissions": [
    "storage",
    "activeTab",
    "alarms",
    "clipboardWrite",
    "identity",
    "webRequest"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "action": {
    "default_popup": "src/popup/index.html",
    "default_icon": {
      "16": "public/icons/icon-16.png",
      "32": "public/icons/icon-32.png",
      "48": "public/icons/icon-48.png",
      "128": "public/icons/icon-128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/autofill.ts", "src/content/passkey-inject.ts"],
      "run_at": "document_idle"
    }
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

Note: `wasm-unsafe-eval` is required for the Argon2 WASM implementation.

#### UI Design System

The UI follows a dark, minimal aesthetic using shadcn/ui primitives. The popup dimensions are 380px × 560px.

**Color Palette (CSS Variables):**

```css
:root {
  --background: 240 10% 3.9%;        /* Near-black */
  --foreground: 0 0% 95%;            /* Off-white */
  --card: 240 6% 6%;                 /* Slightly lighter than bg */
  --card-foreground: 0 0% 95%;
  --popover: 240 6% 6%;
  --primary: 142 71% 45%;            /* Emerald green accent */
  --primary-foreground: 144 80% 10%;
  --secondary: 240 5% 12%;
  --secondary-foreground: 0 0% 95%;
  --muted: 240 5% 15%;
  --muted-foreground: 240 5% 55%;
  --accent: 142 71% 45%;
  --destructive: 0 84% 60%;
  --border: 240 6% 14%;
  --ring: 142 71% 45%;
  --radius: 0.625rem;
}
```

**Typography:**
- Primary font: `"Geist Sans"`, loaded from the extension bundle.
- Monospace (passwords, TOTP codes): `"Geist Mono"`.
- Base size: 13px for extension popup density.

**UI Screens:**

1. **Unlock Screen** — Master password input, biometric unlock toggle (where supported), subtle animated lock icon.
2. **Vault List** — Search bar at top, scrollable list of entries as compact cards showing favicon, site name, username. Entries grouped by category (Login, Card, Identity, Note).
3. **Entry Detail** — Shows all fields for an entry. Password hidden by default with a reveal toggle. TOTP code shown with a circular countdown indicator. Copy buttons on each field. Edit and delete actions.
4. **Entry Form** — Add/edit entries. Fields vary by type. Integrated password generator.
5. **Password Generator** — Slider for length (8–128), toggles for character sets (uppercase, lowercase, digits, symbols), passphrase mode, strength meter, one-click copy.
6. **TOTP Manager** — QR code scanner (via camera access) or manual secret entry. Shows live rotating codes with countdown rings.
7. **Passkey Manager** — List of stored passkeys by relying party. Create, view metadata, delete.
8. **Settings** — Server URL configuration, sync status indicator, Google Drive connection, auto-lock timeout, vault export/import, theme toggle.

---

### 3. Vault Data Model

Each vault entry is a JSON object. The vault itself is an array of entries plus metadata.

```typescript
interface VaultEntry {
  id: string;                          // UUIDv4
  type: "login" | "card" | "identity" | "note";
  name: string;                        // Display name
  favorite: boolean;
  created: number;                     // Unix timestamp (ms)
  modified: number;                    // Unix timestamp (ms)
  // Login fields
  login?: {
    urls: string[];                    // Associated URLs
    username: string;
    password: string;                  // Encrypted per-entry
    totp?: {
      secret: string;                  // Base32 TOTP secret (encrypted)
      algorithm: "SHA1" | "SHA256" | "SHA512";
      digits: 6 | 8;
      period: number;                  // Usually 30
      issuer?: string;
    };
    passkey?: {
      credentialId: string;            // Base64url
      rpId: string;                    // Relying party ID
      rpName: string;
      userHandle: string;              // Base64url
      userName: string;
      privateKey: string;              // COSE key, encrypted per-entry
      publicKey: string;               // COSE key (not secret, for display)
      signCount: number;
      created: number;
    };
    customFields?: {
      name: string;
      value: string;                   // Encrypted per-entry
      hidden: boolean;
    }[];
  };
  // Card fields
  card?: {
    holder: string;
    number: string;                    // Encrypted
    expMonth: string;
    expYear: string;
    cvv: string;                       // Encrypted
    brand?: string;
  };
  // Identity fields
  identity?: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    address?: {
      street: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    };
  };
  // Secure note
  note?: {
    content: string;                   // Encrypted per-entry
  };
  tags: string[];
}

interface Vault {
  version: number;                     // Schema version for migrations
  entries: VaultEntry[];
  folders: { id: string; name: string; }[];
  lastSync: number;                    // Timestamp of last successful sync
  syncVersion: number;                 // Monotonically increasing, for conflict detection
}
```

---

### 4. TOTP Implementation (RFC 6238)

TOTP codes are generated entirely on the client using the Web Crypto API.

```
TOTP(K, T) = Truncate(HMAC-SHA1(K, T))

Where:
  K = shared secret (Base32 decoded)
  T = floor((current_unix_time - T0) / period)
  T0 = 0 (Unix epoch)
  period = 30 seconds (default)
```

**Implementation steps:**

1. Decode the Base32 TOTP secret into raw bytes.
2. Compute the current time step `T` as an 8-byte big-endian integer.
3. Compute `HMAC-SHA1(secret, T)` using Web Crypto's `sign` with the `HMAC` algorithm.
4. Apply dynamic truncation: take 4 bytes starting at the offset defined by the last nibble of the HMAC, interpret as a 31-bit unsigned integer, then modulo 10^digits.
5. Zero-pad to the required number of digits (6 or 8).

**URI parsing** for importing from QR codes or manual entry:

```
otpauth://totp/Label?secret=BASE32SECRET&issuer=Example&algorithm=SHA1&digits=6&period=30
```

---

### 5. Passkey (WebAuthn) Implementation

VaultKey acts as a virtual authenticator — it intercepts WebAuthn `navigator.credentials.create()` and `navigator.credentials.get()` calls and handles them using keys stored in the vault.

#### Registration Flow (create)

1. Content script intercepts `navigator.credentials.create()`.
2. Extension generates a new P-256 (ES256) key pair using Web Crypto.
3. Extension builds the `authenticatorData` and `attestationObject` (self-attestation, "none" attestation format).
4. Private key is encrypted with the entry key and stored in the vault.
5. The credential response is returned to the relying party.

#### Authentication Flow (get)

1. Content script intercepts `navigator.credentials.get()`.
2. Extension looks up matching credentials by `rpId` in the vault.
3. User selects which credential to use (if multiple match).
4. Extension decrypts the private key, signs the `clientDataHash` + `authenticatorData` with ECDSA P-256.
5. Increment `signCount`, re-encrypt entry, sync.
6. Return the assertion response to the relying party.

#### Content Script Injection

The content script replaces `navigator.credentials.create` and `navigator.credentials.get` with proxied versions that communicate with the background service worker via `chrome.runtime.sendMessage`. The original functions are preserved for fallback.

```typescript
// content/passkey-inject.ts (simplified)
const originalCreate = navigator.credentials.create.bind(navigator.credentials);
const originalGet = navigator.credentials.get.bind(navigator.credentials);

navigator.credentials.create = async (options) => {
  if (options?.publicKey) {
    const response = await chrome.runtime.sendMessage({
      type: "PASSKEY_CREATE",
      options: serializePublicKeyOptions(options.publicKey),
    });
    if (response?.credential) return deserializeCredential(response.credential);
  }
  return originalCreate(options);
};

navigator.credentials.get = async (options) => {
  if (options?.publicKey) {
    const response = await chrome.runtime.sendMessage({
      type: "PASSKEY_GET",
      options: serializePublicKeyOptions(options.publicKey),
    });
    if (response?.credential) return deserializeCredential(response.credential);
  }
  return originalGet(options);
};
```

---

### 6. Server Sync Service

The server is a lightweight Node.js application that runs on your LAN server. It handles only encrypted data.

#### Server Project Structure

```
vaultkey-server/
├── src/
│   ├── index.ts               # Entry point, Express/Fastify app
│   ├── routes/
│   │   ├── vault.ts           # PUT/GET encrypted vault blob
│   │   ├── sync.ts            # WebSocket sync notifications
│   │   └── health.ts          # Health check endpoint
│   ├── middleware/
│   │   ├── auth.ts            # HMAC-based request authentication
│   │   └── tls.ts             # mTLS certificate validation
│   ├── storage/
│   │   ├── sqlite.ts          # SQLite vault blob storage
│   │   └── gdrive.ts          # Google Drive backup manager
│   ├── lib/
│   │   ├── types.ts
│   │   └── config.ts
│   └── certs/                 # TLS certificates (generated at setup)
│       ├── ca.pem
│       ├── server.pem
│       ├── server-key.pem
│       ├── client.pem         # Client cert for mTLS
│       └── client-key.pem
├── data/
│   └── vault.db               # SQLite database (encrypted blobs only)
├── scripts/
│   ├── generate-certs.sh      # mTLS certificate generation script
│   └── setup.sh               # First-time setup
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
└── package.json
```

#### API Endpoints

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/health` | Server health check | None |
| `GET` | `/api/vault` | Retrieve encrypted vault blob | HMAC |
| `PUT` | `/api/vault` | Upload encrypted vault blob | HMAC |
| `GET` | `/api/vault/version` | Get current vault sync version | HMAC |
| `WS` | `/api/sync` | WebSocket for real-time sync notifications | HMAC |
| `POST` | `/api/vault/backup` | Trigger Google Drive backup | HMAC |
| `GET` | `/api/vault/backup/status` | Check backup status | HMAC |

#### Request Authentication

Every request includes an HMAC signature:

```
Authorization: HMAC-SHA256 <client-id>:<timestamp>:<signature>

Where:
  signature = HMAC-SHA256(auth_key, method + path + timestamp + body_hash)
  body_hash = SHA-256(request_body) or empty string for GET
  auth_key  = HKDF(master_key, info="server-auth")
```

The server stores a hashed version of each registered client's auth key. It can verify signatures without knowing the master password.

#### Sync Protocol

The sync protocol uses optimistic concurrency with version numbers.

```
Client A                    Server                    Client B
   │                          │                          │
   │  PUT /vault              │                          │
   │  {blob, version: 5}     │                          │
   │ ──────────────────────►  │                          │
   │                          │  Store blob, version=5   │
   │  200 OK                  │                          │
   │ ◄──────────────────────  │                          │
   │                          │  WS: "vault_updated: 5"  │
   │                          │ ─────────────────────►   │
   │                          │                          │
   │                          │  GET /vault              │
   │                          │ ◄─────────────────────   │
   │                          │                          │
   │                          │  200 {blob, version: 5}  │
   │                          │ ─────────────────────►   │
   │                          │                          │
```

**Conflict handling:** If a client attempts `PUT /vault` with a version that doesn't match the server's current version, the server returns `409 Conflict`. The client must fetch the latest version, merge locally (last-modified-wins per entry, using entry `modified` timestamps), re-encrypt, and retry.

---

### 7. Google Drive Backup

Google Drive serves as an encrypted fallback. The vault blob is already encrypted before it ever reaches Google's servers — Google cannot read your passwords.

#### Setup

1. Create a Google Cloud project and enable the Drive API.
2. Create OAuth 2.0 credentials (Desktop app type).
3. The extension uses Chrome's `identity` API (`chrome.identity.launchWebAuthFlow`) for OAuth consent.
4. Store the refresh token encrypted in `chrome.storage.local`.

#### Backup Strategy

```
              ┌─────────────────┐
              │   Vault Change   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Push to Server  │──── Fails? ────┐
              └────────┬────────┘                 │
                       │                          │
                       ▼                          ▼
              ┌─────────────────┐     ┌──────────────────┐
              │  Server Pushes  │     │  Extension Pushes │
              │  to Google Drive│     │  Directly to      │
              │  (background)   │     │  Google Drive     │
              └─────────────────┘     └──────────────────┘
```

- **Normal operation:** The server pushes encrypted backups to Drive on a schedule (every 6 hours) or on every vault change (configurable).
- **Server offline:** The extension detects the server is unreachable and pushes directly to Google Drive from the client.
- **Restore:** If the server's vault is lost, the extension (or a setup script) can pull the latest backup from Google Drive and seed the server.

#### Drive File Structure

```
VaultKey/
├── vault-latest.vkblob          # Latest encrypted vault
├── vault-2026-02-09T12:00.vkblob  # Timestamped backups
├── vault-2026-02-08T12:00.vkblob
└── ...
```

Backups older than 30 days are automatically pruned (configurable). The `.vkblob` format is the same encrypted blob format described in the crypto section.

---

### 8. Autofill Engine

The content script detects login forms and offers to fill credentials.

#### Form Detection Heuristics

1. Find `<input>` elements with `type="password"`.
2. Walk the DOM upward to find the enclosing `<form>` (or infer a "virtual form" from nearby inputs).
3. Identify the username field by checking for `type="email"`, `type="text"` with `name`/`id`/`autocomplete` attributes containing "user", "email", "login", "name".
4. Match the page's origin against vault entry URLs.
5. If a match is found, show an inline icon in the username/password fields. Clicking it fills the credentials.

#### Security Considerations for Autofill

- Never autofill on HTTP pages (only HTTPS).
- Strict origin matching: the page origin must exactly match a stored URL. Subdomain matching is opt-in per entry.
- Show a confirmation before autofilling if the page's URL differs from the stored URL (e.g., redirects).
- Never autofill into hidden or off-screen fields (phishing defense).

---

## Build Instructions

### Prerequisites

- **Node.js** 20+ and npm 10+
- **A LAN server** running Linux, macOS, or Windows with Docker (or Node.js directly)
- **OpenSSL** (for certificate generation)
- **Google Cloud account** (optional, for Drive backup)

---

### Step 1: Set Up the Project

```bash
# Create the monorepo
mkdir vaultkey && cd vaultkey
npm init -y

# Initialize workspaces
mkdir -p packages/extension packages/server packages/shared
```

Update root `package.json`:

```json
{
  "name": "vaultkey",
  "private": true,
  "workspaces": ["packages/*"]
}
```

---

### Step 2: Build the Shared Package

The shared package contains types and crypto utilities used by both the extension and the server.

```bash
cd packages/shared
npm init -y
npm install argon2-browser
```

Create `packages/shared/src/types.ts` with the interfaces defined in the Vault Data Model section above.

Create `packages/shared/src/crypto.ts`:

```typescript
// Core crypto operations using Web Crypto API

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // 1. Encode password
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // 2. Run Argon2id (via WASM)
  const argon2 = await import("argon2-browser");
  const hash = await argon2.hash({
    pass: passwordBytes,
    salt: salt,
    time: 3,          // iterations
    mem: 65536,        // 64 MiB
    parallelism: 4,
    hashLen: 32,
    type: argon2.ArgonType.Argon2id,
  });

  // 3. Import as CryptoKey
  return crypto.subtle.importKey(
    "raw",
    hash.hash,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );
}

export async function deriveSubKey(
  masterKey: CryptoKey,
  info: string,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32), // Empty salt (Argon2 already salted)
      info: encoder.encode(info),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
}

export async function encrypt(
  key: CryptoKey,
  data: ArrayBuffer,
  aad?: ArrayBuffer
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    data
  );
  // Prepend IV to ciphertext
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result.buffer;
}

export async function decrypt(
  key: CryptoKey,
  data: ArrayBuffer,
  aad?: ArrayBuffer
): Promise<ArrayBuffer> {
  const iv = new Uint8Array(data, 0, 12);
  const ciphertext = new Uint8Array(data, 12);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    ciphertext
  );
}
```

---

### Step 3: Build the Browser Extension

```bash
cd packages/extension

# Initialize with Vite + React + TypeScript
npm create vite@latest . -- --template react-ts

# Install dependencies
npm install
npm install -D tailwindcss @tailwindcss/vite
npm install class-variance-authority clsx tailwind-merge lucide-react
npm install argon2-browser

# Initialize shadcn/ui
npx shadcn@latest init
# Select: New York style, Zinc color, CSS variables: yes

# Add shadcn components
npx shadcn@latest add button input card dialog tabs badge scroll-area \
  dropdown-menu switch toast separator avatar tooltip
```

Configure Vite for extension builds. Create `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        background: resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/autofill.ts"),
        passkey: resolve(__dirname, "src/content/passkey-inject.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

---

### Step 4: Build the Server

```bash
cd packages/server
npm init -y
npm install fastify @fastify/websocket @fastify/cors better-sqlite3 googleapis
npm install -D typescript @types/better-sqlite3 tsx
```

Create `packages/server/src/index.ts`:

```typescript
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import fs from "fs";
import path from "path";
import { vaultRoutes } from "./routes/vault";
import { syncRoutes } from "./routes/sync";

const PORT = parseInt(process.env.VAULTKEY_PORT || "8743");
const CERTS_DIR = process.env.VAULTKEY_CERTS || "./certs";

const app = Fastify({
  https: {
    key: fs.readFileSync(path.join(CERTS_DIR, "server-key.pem")),
    cert: fs.readFileSync(path.join(CERTS_DIR, "server.pem")),
    ca: fs.readFileSync(path.join(CERTS_DIR, "ca.pem")),
    requestCert: true,        // mTLS: require client certificate
    rejectUnauthorized: true,
  },
  logger: true,
});

app.register(cors, {
  origin: true, // Allow extension origin
});
app.register(websocket);
app.register(vaultRoutes, { prefix: "/api" });
app.register(syncRoutes, { prefix: "/api" });

app.get("/health", async () => ({ status: "ok", version: "1.0.0" }));

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`VaultKey server listening on port ${PORT}`);
});
```

---

### Step 5: Generate TLS Certificates

Create `packages/server/scripts/generate-certs.sh`:

```bash
#!/bin/bash
set -e

CERTS_DIR="${1:-./certs}"
DAYS=3650
SERVER_IP="${2:-$(hostname -I | awk '{print $1}')}"

mkdir -p "$CERTS_DIR"

echo "==> Generating Certificate Authority"
openssl ecparam -genkey -name prime256v1 -out "$CERTS_DIR/ca-key.pem"
openssl req -new -x509 -key "$CERTS_DIR/ca-key.pem" \
  -out "$CERTS_DIR/ca.pem" -days $DAYS \
  -subj "/CN=VaultKey CA/O=VaultKey"

echo "==> Generating Server Certificate"
openssl ecparam -genkey -name prime256v1 -out "$CERTS_DIR/server-key.pem"
openssl req -new -key "$CERTS_DIR/server-key.pem" \
  -out "$CERTS_DIR/server.csr" \
  -subj "/CN=VaultKey Server/O=VaultKey"

cat > "$CERTS_DIR/server-ext.cnf" << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:$SERVER_IP,DNS:localhost,IP:127.0.0.1
EOF

openssl x509 -req -in "$CERTS_DIR/server.csr" \
  -CA "$CERTS_DIR/ca.pem" -CAkey "$CERTS_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERTS_DIR/server.pem" -days $DAYS \
  -extfile "$CERTS_DIR/server-ext.cnf"

echo "==> Generating Client Certificate"
openssl ecparam -genkey -name prime256v1 -out "$CERTS_DIR/client-key.pem"
openssl req -new -key "$CERTS_DIR/client-key.pem" \
  -out "$CERTS_DIR/client.csr" \
  -subj "/CN=VaultKey Client/O=VaultKey"
openssl x509 -req -in "$CERTS_DIR/client.csr" \
  -CA "$CERTS_DIR/ca.pem" -CAkey "$CERTS_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERTS_DIR/client.pem" -days $DAYS

# Cleanup CSRs
rm -f "$CERTS_DIR"/*.csr "$CERTS_DIR"/*.cnf "$CERTS_DIR"/*.srl

echo "==> Certificates generated in $CERTS_DIR"
echo "    Server IP: $SERVER_IP"
echo "    Valid for: $DAYS days"
```

Run it:

```bash
chmod +x scripts/generate-certs.sh
./scripts/generate-certs.sh ./certs 192.168.1.100  # Replace with your server IP
```

---

### Step 6: Docker Deployment (Server)

Create `packages/server/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY certs/ ./certs/

RUN mkdir -p /app/data

ENV VAULTKEY_PORT=8743
ENV VAULTKEY_CERTS=/app/certs
ENV VAULTKEY_DATA=/app/data

EXPOSE 8743

CMD ["node", "dist/index.js"]
```

Create `packages/server/docker-compose.yml`:

```yaml
version: "3.8"
services:
  vaultkey:
    build: .
    ports:
      - "8743:8743"
    volumes:
      - vaultkey-data:/app/data
      - ./certs:/app/certs:ro
    restart: unless-stopped
    environment:
      - VAULTKEY_PORT=8743

volumes:
  vaultkey-data:
```

Deploy:

```bash
# Build TypeScript
npx tsc

# Build and start container
docker compose up -d
```

---

### Step 7: Google Drive Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project called "VaultKey".
3. Enable the **Google Drive API**.
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**.
5. Application type: **Web application**.
6. Add authorized redirect URI: `https://<extension-id>.chromiumapp.org/` (you'll get the extension ID after loading it in Chrome).
7. Download the credentials JSON.
8. Add the `client_id` to the extension's configuration (not the secret — the extension uses PKCE for OAuth).

In the extension settings, the user clicks "Connect Google Drive", completes the OAuth flow, and the refresh token is encrypted and stored locally.

---

### Step 8: Build and Load the Extension

```bash
cd packages/extension

# Build
npm run build

# The built extension is in dist/
```

**Load in Chrome:**

1. Navigate to `chrome://extensions/`.
2. Enable "Developer mode".
3. Click "Load unpacked".
4. Select the `packages/extension/dist/` directory.
5. Note the extension ID for Google Drive OAuth configuration.

**Load in Firefox:**

1. Navigate to `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on".
3. Select any file in `packages/extension/dist/`.

---

## Security Checklist

Before using VaultKey with real credentials, verify each of the following:

- [ ] Master password is never sent to the server (inspect network traffic with browser DevTools).
- [ ] Vault blob is encrypted before storage (verify by inspecting SQLite DB contents — should be opaque binary).
- [ ] TLS is enforced on all server connections (reject plain HTTP).
- [ ] mTLS client certificate is validated by the server (test with curl without a client cert — should fail).
- [ ] HMAC authentication rejects invalid/expired signatures (test with tampered requests).
- [ ] Vault auto-locks after the configured idle timeout.
- [ ] Clipboard auto-clears after 30 seconds.
- [ ] Autofill only triggers on HTTPS pages.
- [ ] Google Drive backup file is encrypted (download and verify it's not plaintext JSON).
- [ ] Argon2id parameters meet minimum recommendations (64 MiB memory, 3 iterations).
- [ ] No plaintext secrets appear in `chrome.storage.local` (inspect via DevTools).
- [ ] Content script doesn't leak vault data to page scripts (verify CSP isolation).

---

## Development Roadmap

### Phase 1 — Core (Weeks 1–3)

- [ ] Crypto layer: Argon2id KDF, AES-256-GCM encrypt/decrypt, HKDF sub-key derivation.
- [ ] Vault CRUD: Create, read, update, delete entries in encrypted local storage.
- [ ] Popup UI: Unlock screen, vault list, entry detail, entry form.
- [ ] Password generator with strength meter.
- [ ] Basic autofill for login forms.

### Phase 2 — TOTP and Passkeys (Weeks 4–5)

- [ ] TOTP: Generate codes, QR scanner, manual secret entry, countdown display.
- [ ] Passkeys: WebAuthn interception, key generation, assertion signing.
- [ ] Entry type expansion: cards, identities, secure notes.

### Phase 3 — Server Sync (Weeks 6–7)

- [ ] Server: REST API, SQLite storage, WebSocket notifications.
- [ ] mTLS certificate generation and validation.
- [ ] HMAC request authentication.
- [ ] Sync protocol with conflict resolution.
- [ ] Extension sync client: push/pull, real-time update handling.

### Phase 4 — Google Drive Backup (Week 8)

- [ ] OAuth 2.0 flow via Chrome identity API.
- [ ] Encrypted blob upload/download to Drive.
- [ ] Automatic backup scheduling.
- [ ] Fallback: direct-to-Drive when server is offline.
- [ ] Backup pruning (30-day retention).

### Phase 5 — Polish (Weeks 9–10)

- [ ] Cross-browser testing (Chrome, Firefox, Edge).
- [ ] Firefox Android extension support.
- [ ] Import from other password managers (Proton Pass, Chrome, 1Password CSV).
- [ ] Export vault (encrypted and plaintext CSV).
- [ ] Security audit against the checklist above.
- [ ] Performance profiling (Argon2 tuning, UI responsiveness).

---

## Future Considerations

- **Mobile companion app** (React Native or Flutter) for iOS/Android, connecting to the same server.
- **CRDT-based merging** for conflict-free multi-device sync instead of last-modified-wins.
- **Hardware key support** (FIDO2 physical keys) as a second factor for vault unlock.
- **Secure sharing** — share individual entries with other VaultKey users using public-key encryption.
- **Browser-native password manager integration** — register VaultKey as the system credential manager via the Credential Management API.
- **Breach monitoring** — check stored passwords against Have I Been Pwned (k-anonymity API, no passwords sent).

---

## License

This is a private project. All code is for personal use.
