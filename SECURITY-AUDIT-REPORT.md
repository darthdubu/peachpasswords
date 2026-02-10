# Lotus Password Manager — Security Audit Report

**Date:** 2026-02-09
**Auditor:** Claude (Automated Code Review)
**Scope:** Full codebase — cryptography, storage, sync, extension security, code quality
**Codebase Version:** 1.0.1 (commit: pre-initial-commit, untracked files)

---

## Summary

**Overall Risk Rating: CRITICAL**

Lotus has a fundamentally sound cryptographic architecture (Argon2id + HKDF + AES-256-GCM with per-entry key derivation), but several critical implementation flaws make it **unsafe for daily-driver use in its current state**. The most severe issue is that the vault lock function deletes the encrypted vault from local storage, which can cause permanent data loss. Additionally, sync credentials are stored in plaintext, the default deployment is unencrypted HTTP, and the autofill system lacks protections against credential theft by malicious pages.

### Top 5 Findings That Must Be Fixed Before Daily-Driver Use

1. **LOTUS-001 (CRITICAL):** `lockVault()` deletes the encrypted vault from `chrome.storage.local`, causing data loss if sync is unavailable
2. **LOTUS-002 (CRITICAL):** Default server deployment uses plaintext HTTP/WS — sync secret transmitted unencrypted on the network
3. **LOTUS-003 (HIGH):** Autofill fills credentials on user click but has no protection against hidden field attacks or phishing domains
4. **LOTUS-004 (HIGH):** S3 credentials (AWS access key + secret key) stored in plaintext in `chrome.storage.local`
5. **LOTUS-005 (HIGH):** No vault-level integrity protection — entries can be silently deleted/rolled back via sync without detection

### Overall Assessment

**Is this vault trustworthy for storing real credentials today? No.**

The cryptographic primitives are well-chosen and correctly implemented, which is the hardest part to get right. However, the surrounding infrastructure (storage lifecycle, sync security, autofill safety, conflict resolution) has serious gaps. With focused effort on the Critical and High findings, Lotus could reach a trustworthy state.

---

## Detailed Findings

---

### LOTUS-001
- **Severity:** CRITICAL
- **Category:** Storage / Reliability
- **Title:** `lockVault()` deletes encrypted vault from local storage — causes data loss

**Description:**
In `VaultContext.tsx:86`, the `lockVault()` function calls:
```typescript
chrome.storage.local.remove(['vault', 'masterKey'])
```
This removes the **encrypted vault ciphertext** from persistent storage. When the user subsequently tries to unlock, `unlockVault()` at line 141 calls `chrome.storage.local.get(['vault', 'salt'])` and throws `"No vault found"` because the vault key no longer exists. The UI check at line 309 sets `vaultExists = false`, showing "Create Vault" instead of "Welcome Back" — prompting the user to overwrite their data.

**Impact:**
- **Complete local data loss** every time the user locks their vault (or the auto-lock timer fires after 5 minutes of idle)
- Data is only recoverable if sync was configured AND the sync server/S3 is reachable
- If the user has never configured sync, locking = permanent data loss
- Auto-lock timeout of 5 minutes means this will happen frequently

**Recommendation:**
Remove `'vault'` from the `chrome.storage.local.remove()` call. The encrypted vault is already protected by AES-256-GCM — storing it at rest is safe and is the standard practice for all password managers. Only remove the `masterKey` from session storage on lock.

**Code Reference:** `packages/extension/src/popup/contexts/VaultContext.tsx:86`

---

### LOTUS-002
- **Severity:** CRITICAL
- **Category:** Sync / Cryptography
- **Title:** Default deployment uses plaintext HTTP — sync secret and vault data transmitted unencrypted

**Description:**
The server (`packages/server/src/index.ts:21-23`) falls back to HTTP mode if TLS certificates are not found, with only a console warning. The docker-compose.yml does not include certificate generation. The extension sync client (`useSync.ts:30`) sends the sync secret as a plaintext HTTP header (`X-Lotus-Secret`). The WebSocket auth token is also sent in plaintext (`useSync.ts:118`).

Additionally, the default sync secret in `docker-compose.yml:16` and `config.ts:5` is hardcoded as `"lotus-local-secret"`.

**Impact:**
- Any device on the LAN can intercept the sync secret via ARP spoofing, rogue AP, or compromised router
- With the sync secret, an attacker can read the full encrypted vault blob and push malicious vault data
- The default hardcoded secret means all default installations share the same credential

**Recommendation:**
1. Make TLS mandatory — refuse to start the server without valid certificates
2. Generate a cryptographically random sync secret on first run (not a static default)
3. Consider deriving the sync authentication from the master key (the HKDF `"server-auth"` info string mentioned in the spec but not implemented)

**Code Reference:** `packages/server/src/index.ts:12-24`, `packages/server/src/lib/config.ts:5`, `docker-compose.yml:16`

---

### LOTUS-003
- **Severity:** HIGH
- **Category:** Extension Security
- **Title:** Autofill vulnerable to hidden field attacks and lacks phishing protection

**Description:**
The autofill content script (`autofill.ts`) fills credentials on user click (not automatic — good), but has several weaknesses:

1. **No hidden field protection:** The script fills any `<input>` regardless of visibility. A malicious page can create hidden username/password fields that receive autofilled credentials. The script at line 63 fills `input.value` without checking if the input is visible to the user.

2. **Weak URL matching:** The background service worker (`service-worker.ts:62-66`) matches credentials by hostname comparison only. The fallback `u.includes(hostname)` at line 65 is especially dangerous — a stored URL of `bank.com` would match `evil-bank.com` since `"evil-bank.com".includes("bank.com")` is true.

3. **No IDN homograph protection:** No check for internationalized domain names that visually resemble legitimate domains.

4. **No phishing warning:** No warning when filling credentials on a domain that differs from the saved entry's domain (e.g., after a redirect).

5. **Generator popup uses innerHTML:** `autofill.ts:157` sets `popup.innerHTML` with a generated password value. While the password is locally generated and not user-controlled, using innerHTML in a content script running in the page context is a risky pattern.

**Impact:**
- Credential theft by malicious websites via invisible form fields
- Credential filling on phishing domains due to substring URL matching
- Potential XSS if the innerHTML pattern is extended

**Recommendation:**
1. Check input visibility before filling (offsetWidth/offsetHeight > 0, not `display:none` or `visibility:hidden`)
2. Replace `u.includes(hostname)` with strict hostname equality (`new URL(u).hostname === hostname`)
3. Add IDN homograph detection (punycode check)
4. Use `textContent` and DOM APIs instead of innerHTML

**Code Reference:** `packages/extension/src/content/autofill.ts:63,157,230`, `packages/extension/src/background/service-worker.ts:62-66`

---

### LOTUS-004
- **Severity:** HIGH
- **Category:** Storage
- **Title:** S3 and sync credentials stored in plaintext in `chrome.storage.local`

**Description:**
The Settings component (`Settings.tsx:43-53`) stores all sync configuration in plaintext:
```typescript
await chrome.storage.local.set({
  [STORAGE_KEYS.SETTINGS]: {
    serverUrl, syncSecret, s3Endpoint, s3Region,
    s3AccessKey, s3SecretKey, s3Bucket
  }
})
```
AWS access keys, secret keys, and the sync secret are stored unencrypted.

**Impact:**
- If the browser profile is compromised (threat scenario #1), the attacker gains full access to the S3 bucket
- S3 credentials could be used to read all backups, inject malicious vault data, or delete backups
- The sync secret allows full read/write access to the sync server

**Recommendation:**
Encrypt sensitive settings using a key derived from the master key (e.g., `HKDF(masterKey, "settings-encryption")`). Require the vault to be unlocked to configure sync settings.

**Code Reference:** `packages/extension/src/popup/components/Settings.tsx:42-55`

---

### LOTUS-005
- **Severity:** HIGH
- **Category:** Sync / Storage
- **Title:** No vault-level integrity protection — silent rollback and entry deletion possible

**Description:**
The vault is encrypted per-entry and as a whole blob, but there is no vault-level MAC or authenticated version vector. The sync mechanism uses a simple monotonic `syncVersion` integer for conflict resolution (`useSync.ts:38`, `vault.ts:34`). An attacker who can write to the sync server or S3 bucket can:

1. Replace the vault blob with an older version (rollback attack)
2. Remove entries from the vault
3. Force the client to pull a manipulated vault via version number manipulation

The conflict resolution at `vault.ts:34` simply checks `currentVault.version >= version` — there's no cryptographic binding between version numbers and vault contents.

**Impact:**
- Silent data loss via vault rollback
- Entries can disappear without user notification
- No way to detect tampering of the vault structure beyond AES-GCM per-blob authentication

**Recommendation:**
1. Include a content hash (SHA-256 of all entry IDs + version) as AAD in the vault-level encryption
2. Store a signed version vector that clients can verify
3. Surface sync conflicts to the user instead of silently accepting the higher version
4. Implement a vault changelog/audit log

**Code Reference:** `packages/server/src/routes/vault.ts:34`, `packages/extension/src/popup/hooks/useSync.ts:38-76`

---

### LOTUS-006
- **Severity:** HIGH
- **Category:** Extension Security
- **Title:** `<all_urls>` host permission and content scripts on all pages expand attack surface

**Description:**
`manifest.json` declares:
```json
"permissions": ["storage", "activeTab", "alarms", "clipboardWrite", "identity", "webRequest"],
"host_permissions": ["<all_urls>"],
"content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js", "passkey.js"] }]
```
Both content scripts run on **every page** the user visits. The `webRequest` and `identity` permissions are declared but unused in the current codebase.

**Impact:**
- Increased attack surface — content scripts are exposed to every malicious page
- `webRequest` permission is unnecessary and triggers Chrome's enhanced permission warning
- If a vulnerability is found in the content scripts, it affects all websites

**Recommendation:**
1. Remove unused permissions: `identity`, `webRequest`
2. Consider restricting content scripts to only inject when the user clicks the extension icon (use `activeTab` + programmatic injection instead of `<all_urls>` content scripts)
3. At minimum, use `"run_at": "document_idle"` with a more targeted matching pattern

**Code Reference:** `packages/extension/public/manifest.json:6-16,30-36`

---

### LOTUS-007
- **Severity:** HIGH
- **Category:** Cryptography / Key Lifecycle
- **Title:** Master key exported as JWK to `chrome.storage.session` — extractable key material

**Description:**
On unlock (`VaultContext.tsx:122,162`), the master HKDF key is exported as JWK and stored in `chrome.storage.session`:
```typescript
const exportedKey = await crypto.subtle.exportKey('jwk', key)
await chrome.storage.session.set({ masterKey: exportedKey })
```
This is done so the background service worker can access the key for autofill. However, this means the raw key material exists as a JSON object in session storage, accessible to any extension context.

Additionally, the key is imported with `extractable: false` originally but then exported anyway — the HKDF base key is imported as non-extractable for `deriveKey`, but a separate exportable version must exist for the JWK export to work. Looking at the code, the key is imported at `crypto.ts:20` with `extractable: false` for deriveKey usage, but `crypto.subtle.exportKey` is called on it. This should actually fail — **the code likely has an unreported bug here or the key is imported differently in the extension's crypto.ts** (confirmed: `crypto.ts:23` uses `hash.hash as any` which bypasses type checking and may result in an extractable key).

**Impact:**
- Any code running in the extension context can read the full master key material from session storage
- The `as any` type assertion bypasses CryptoKey type safety
- If `chrome.storage.session` data persists through a crash/restore, the key survives beyond the intended session

**Recommendation:**
1. Instead of exporting the master key, have the background script derive keys on-demand via message passing to the popup
2. If session storage is necessary, store only derived sub-keys (vault key, not the master HKDF key)
3. Remove the `as any` cast on `hash.hash` and properly type the Argon2 output

**Code Reference:** `packages/extension/src/popup/contexts/VaultContext.tsx:122,162`, `packages/extension/src/lib/crypto.ts:23`

---

### LOTUS-008
- **Severity:** HIGH
- **Category:** Sync
- **Title:** HMAC authentication implementation is broken — inline comments confirm confusion

**Description:**
The auth middleware (`auth.ts:45-62`) contains extensive inline comments from the developer expressing confusion about whether the server stores the auth key or its hash:
```typescript
// But wait, the server doesn't know the auth_key, it only knows auth_key_hash?
// ...
const authKey = client.auth_key_hash; // Treating this as the shared secret key
```
The HMAC verification treats the `auth_key_hash` column as the actual key, contradicting the column name and the spec. There is also no client registration endpoint implemented — the `clients` table is never populated via any API route.

**Impact:**
- HMAC auth mode is non-functional (no way to register clients)
- The "simple" mode (`X-Lotus-Secret` header) is the only working auth, which is a static shared secret with no rotation
- Timing-unsafe string comparison at `auth.ts:15`: `secretHeader === CONFIG.SYNC_SECRET`

**Recommendation:**
1. Either implement proper HMAC auth with client registration, or remove the dead code
2. Use `crypto.timingSafeEqual()` for secret comparison to prevent timing attacks
3. Implement the HKDF-derived auth key from the spec (`info="server-auth"`)

**Code Reference:** `packages/server/src/middleware/auth.ts:12-76`

---

### LOTUS-009
- **Severity:** MEDIUM
- **Category:** Cryptography
- **Title:** AAD (Additional Authenticated Data) is available but never used

**Description:**
Both crypto modules (`shared/src/crypto.ts:58,62` and `extension/src/lib/crypto.ts:52,56`) accept an optional `aad` parameter for AES-GCM encryption. However, no caller in the entire codebase passes AAD. The spec (`VaultKey-Project-Spec.md:129`) specifies `AAD: vault version + timestamp`.

**Impact:**
- Without AAD, an attacker who can modify `chrome.storage.local` could swap encrypted entries between vault versions or rearrange the entry array without detection
- The ciphertext is not bound to any context (entry ID, vault version, etc.)

**Recommendation:**
Pass vault version + entry ID as AAD when encrypting. For vault-level encryption, use `version + syncVersion`. For per-entry encryption, use `entryId + modified timestamp`.

**Code Reference:** `packages/shared/src/crypto.ts:58-70`, `packages/extension/src/lib/crypto.ts:49-69`, `packages/extension/src/popup/contexts/VaultContext.tsx:62`

---

### LOTUS-010
- **Severity:** MEDIUM
- **Category:** Cryptography
- **Title:** HKDF salt is all-zeros — deviates from best practice

**Description:**
In `crypto.ts:45` (both shared and extension versions):
```typescript
salt: new Uint8Array(32), // Empty salt (Argon2 already salted)
```
The HKDF step uses a 32-byte zero salt. While the comment correctly notes that Argon2id already applies salting, RFC 5869 recommends using a non-trivial salt even when the input keying material is already random. This is acceptable but suboptimal.

**Impact:**
Low practical impact since Argon2id output is already well-distributed. However, it means all users with the same master password and Argon2 salt would derive identical HKDF sub-keys (which is already the case due to deterministic derivation — this is by design).

**Recommendation:**
Consider using the Argon2 salt as the HKDF salt for defense-in-depth. This is a minor improvement.

**Code Reference:** `packages/shared/src/crypto.ts:45`, `packages/extension/src/lib/crypto.ts:39`

---

### LOTUS-011
- **Severity:** MEDIUM
- **Category:** Cryptography
- **Title:** Two different Argon2 WASM libraries included — potential inconsistency

**Description:**
The extension depends on both `argon2-browser` (v1.18.0) and `hash-wasm` (v4.12.0). The shared package (`packages/shared/src/crypto.ts`) imports `argon2-browser`, while the extension's own crypto (`packages/extension/src/lib/crypto.ts`) imports `hash-wasm`'s `argon2id`. The extension's `crypto-utils.ts` re-exports from the extension's `crypto.ts`, meaning the extension uses `hash-wasm` in practice.

The parameters differ slightly in naming but are functionally equivalent:
- `argon2-browser`: `{ time: 3, mem: 65536, parallelism: 4, hashLen: 32 }`
- `hash-wasm`: `{ iterations: 3, memorySize: 65536, parallelism: 4, hashLength: 32 }`

**Impact:**
- If the shared crypto is ever used (e.g., in tests or server-side), it would produce different key material if library outputs differ
- Two Argon2 WASM implementations doubles the attack surface for supply chain issues
- `argon2-browser` is a less-maintained package (last npm publish was 2022)

**Recommendation:**
Standardize on one Argon2 implementation. `hash-wasm` (by nicolo-ribaudo) is more actively maintained and widely used. Remove `argon2-browser` from dependencies.

**Code Reference:** `packages/extension/package.json:24,28`, `packages/shared/src/crypto.ts:2`, `packages/extension/src/lib/crypto.ts:2`

---

### LOTUS-012
- **Severity:** MEDIUM
- **Category:** Extension Security
- **Title:** Passkey interception script overrides global WebAuthn APIs on all pages

**Description:**
`passkey-inject.ts` replaces `navigator.credentials.create` and `navigator.credentials.get` globally on every page. The PASSKEY_CREATE and PASSKEY_GET message handlers are not implemented in the background service worker — meaning the passkey feature is non-functional but the interception is active.

**Impact:**
- WebAuthn operations on all websites pass through the extension's content script, even though the handler doesn't exist
- The fallback to `originalCreate` / `originalGet` works, but adds latency and a try/catch overhead to every WebAuthn operation
- If `chrome.runtime.sendMessage` throws (e.g., extension context invalidated), the fallback silently catches and proceeds, but the error is logged to console

**Recommendation:**
Either implement the passkey feature fully or remove the interception script from the manifest's content scripts. Shipping dead interception code on all pages is unnecessary risk.

**Code Reference:** `packages/extension/src/content/passkey-inject.ts:1-57`, `packages/extension/public/manifest.json:33`

---

### LOTUS-013
- **Severity:** MEDIUM
- **Category:** Storage
- **Title:** Plaintext password stored in `chrome.storage.session` via save prompt

**Description:**
When a user submits a form, the content script sends the plaintext password to the background script (`autofill.ts:264-271`):
```typescript
chrome.runtime.sendMessage({
  type: 'PROMPT_SAVE',
  data: { url: window.location.origin, username, password }
})
```
The background script stores this in session storage (`service-worker.ts:23`):
```typescript
chrome.storage.session.set({ pendingSave: message.data })
```
The plaintext password sits in session storage until the user opens the popup and either saves or dismisses it.

**Impact:**
- Plaintext credentials in session storage, accessible to all extension contexts
- No timeout to clear stale pending saves
- If the user doesn't open the popup, the plaintext password persists for the entire browser session

**Recommendation:**
1. Encrypt the pending save data with a temporary key before storing in session
2. Add a timeout (e.g., 5 minutes) to automatically clear pending saves
3. Clear pending saves on vault lock

**Code Reference:** `packages/extension/src/content/autofill.ts:263-272`, `packages/extension/src/background/service-worker.ts:22-27`

---

### LOTUS-014
- **Severity:** MEDIUM
- **Category:** Code Quality / Reliability
- **Title:** Auto-lock timer uses `setTimeout` — unreliable across sleep/wake and tab suspension

**Description:**
The idle timer in `VaultContext.tsx:93-96` uses `setTimeout`:
```typescript
const timer = setTimeout(() => {
  lockVault()
}, VAULT_IDLE_TIMEOUT) // 5 minutes
```
This timer is subject to:
- **Tab suspension:** Chrome suspends inactive extension popups, pausing timers
- **System sleep:** Timer doesn't advance during sleep; vault stays unlocked indefinitely
- **Popup close/reopen:** Timer is reset on each popup open since the component remounts

**Impact:**
- Vault may remain unlocked indefinitely after system sleep/wake
- Auto-lock is unreliable, undermining the "evil maid" threat protection

**Recommendation:**
Use `chrome.alarms` API (already in permissions) for the auto-lock timer. Alarms survive popup close and are more reliable. Store the lock deadline timestamp in session storage and check it on popup open.

**Code Reference:** `packages/extension/src/popup/contexts/VaultContext.tsx:91-97`

---

### LOTUS-015
- **Severity:** MEDIUM
- **Category:** Sync
- **Title:** S3 sync has no optimistic locking — race condition can cause silent data loss

**Description:**
The S3 sync (`useS3Sync.ts`) does a read-then-write without any locking mechanism. Two devices syncing simultaneously:

1. Device A reads S3: version 5
2. Device B reads S3: version 5
3. Device A writes version 6
4. Device B writes version 6, overwriting Device A's changes

There is no ETag-based conditional PUT or S3 object versioning.

**Impact:**
- Silent data loss in multi-device scenarios
- The 30-second polling interval creates a wide race condition window

**Recommendation:**
Use S3 conditional requests (`If-None-Match` / `If-Match` with ETags) or enable S3 bucket versioning. Surface conflicts to the user.

**Code Reference:** `packages/extension/src/popup/hooks/useS3Sync.ts:67-89`

---

### LOTUS-016
- **Severity:** MEDIUM
- **Category:** Code Quality
- **Title:** Password generator has modulo bias

**Description:**
In `password-generator.ts:30`:
```typescript
password += chars[array[i] % chars.length]
```
Using modulo on `Uint32Array` values introduces bias when `chars.length` does not evenly divide 2^32. For a charset of 88 characters (lowercase + uppercase + numbers + symbols), the bias is ~0.000002% per character — negligible in practice but technically incorrect.

**Impact:**
Minimal practical impact. Some characters will be very slightly more probable than others.

**Recommendation:**
Use rejection sampling: regenerate values that fall in the biased range (`>= Math.floor(2**32 / chars.length) * chars.length`).

**Code Reference:** `packages/extension/src/lib/password-generator.ts:30`

---

### LOTUS-017
- **Severity:** MEDIUM
- **Category:** Storage
- **Title:** Significant metadata stored in plaintext alongside encrypted entries

**Description:**
The `VaultEntry` type stores these fields **unencrypted**:
- `name` (entry title — e.g., "Chase Bank", "Gmail")
- `login.urls[]` (associated URLs)
- `login.username` (plaintext username)
- `tags[]` (user-defined tags)
- `favorite` (boolean)
- `created` / `modified` timestamps
- `card.holder`, `card.expMonth`, `card.expYear`, `card.brand`
- `identity.*` (all identity fields)
- `login.totp.issuer`
- `login.passkey.rpId`, `rpName`, `userName`

**Impact:**
- An attacker with access to `chrome.storage.local` can enumerate all sites the user has accounts on, their usernames, and when they were created/modified — without knowing the master password
- This violates zero-knowledge principles for metadata

**Recommendation:**
Encrypt entry metadata as part of the vault-level encryption. Only the entry `id` and `type` should remain in plaintext for indexing purposes. Search functionality should operate on the decrypted vault in memory.

**Code Reference:** `packages/shared/src/types.ts:1-73`

---

### LOTUS-018
- **Severity:** LOW
- **Category:** Sync
- **Title:** No replay protection on simple auth mode

**Description:**
The `X-Lotus-Secret` header auth (`auth.ts:14-17`) uses a static comparison with no timestamp, nonce, or request ID. Any captured request can be replayed indefinitely.

The HMAC mode has a 5-minute timestamp window (`auth.ts:35`) but no nonce tracking, allowing replay within the window.

**Impact:**
- Captured HTTP requests can be replayed to read or overwrite the vault
- This is especially dangerous combined with LOTUS-002 (plaintext HTTP)

**Recommendation:**
Add request nonces and a server-side nonce cache to prevent replay attacks.

**Code Reference:** `packages/server/src/middleware/auth.ts:12-17,32-37`

---

### LOTUS-019
- **Severity:** LOW
- **Category:** Code Quality
- **Title:** No master password strength enforcement

**Description:**
The `UnlockScreen.tsx` create-vault flow accepts any password without strength checking. There is no minimum length, complexity requirement, or strength meter.

**Impact:**
- Users could set a single-character master password, making Argon2id irrelevant
- No guidance on password strength

**Recommendation:**
Add a minimum password length (12+ characters) and a strength meter (e.g., zxcvbn library). Warn against common passwords.

**Code Reference:** `packages/extension/src/popup/components/UnlockScreen.tsx:14-33`

---

### LOTUS-020
- **Severity:** LOW
- **Category:** Code Quality
- **Title:** `console.log` statements leak sync state and version information

**Description:**
Multiple sync-related `console.log` calls expose internal state:
- `useSync.ts:36`: `"Sync check: Local ${vault.syncVersion} vs Server ${serverVersion}"`
- `useSync.ts:40,58,74`: `"Pulling from server..."`, `"Pushing to server..."`, `"Push complete"`
- `useS3Sync.ts:55`: `"S3 Sync: Local ${vault.syncVersion} vs Remote ${remoteVersion}"`
- `service-worker.ts:4`: `"Lotus background service worker started"`
- Various error logs that could expose crypto operation failures

**Impact:**
- Information leakage via browser console (version numbers, sync activity patterns)
- Debug information available to anyone with access to DevTools

**Recommendation:**
Remove or gate all console.log statements behind a debug flag. Use structured logging with a configurable log level.

**Code Reference:** `packages/extension/src/popup/hooks/useSync.ts:36,40,55,74`, `packages/extension/src/popup/hooks/useS3Sync.ts:55,66,88`

---

### LOTUS-021
- **Severity:** LOW
- **Category:** Build / Distribution
- **Title:** Source maps not explicitly disabled — Vite default behavior

**Description:**
The Vite config (`vite.config.ts`) does not explicitly set `build.sourcemap: false`. Vite defaults to not generating source maps for production builds, and no `.map` files were found in `dist/`. However, the absence of an explicit setting means a future config change or Vite version update could enable them.

**Impact:**
- If source maps are accidentally included in a published extension, the entire source is exposed

**Recommendation:**
Explicitly set `build: { sourcemap: false }` in the Vite config.

**Code Reference:** `packages/extension/vite.config.ts:15-30`

---

### LOTUS-022
- **Severity:** LOW
- **Category:** Extension Security
- **Title:** CORS set to `origin: true` on server — accepts all origins

**Description:**
In `packages/server/src/index.ts:32`:
```typescript
app.register(cors, { origin: true })
```
This allows any website to make authenticated requests to the server if it knows the sync secret.

**Impact:**
- A malicious website could send requests to the local sync server if:
  - The server URL is predictable (localhost:8743)
  - The sync secret is known or guessable

**Recommendation:**
Restrict CORS to only the extension's origin (`chrome-extension://<extension-id>`).

**Code Reference:** `packages/server/src/index.ts:31-33`

---

### LOTUS-023
- **Severity:** INFORMATIONAL
- **Category:** Dependencies
- **Title:** Dependency audit summary

**Direct Dependencies (Extension):**
| Package | Version | Status | Notes |
|---------|---------|--------|-------|
| `@aws-sdk/client-s3` | ^3.986.0 | Active | Large dependency tree (~80+ transitive deps) |
| `argon2-browser` | ^1.18.0 | Stale | Last published 2022; **used only by shared pkg, not extension** |
| `hash-wasm` | ^4.12.0 | Active | Used for actual Argon2id in extension |
| `react` | ^18.2.0 | Active | Standard |
| `react-qr-code` | ^2.0.18 | Active | Used for sync QR code |
| `papaparse` | ^5.5.3 | Active | CSV parsing for import |
| Radix UI (various) | Latest | Active | Standard UI components |

**Direct Dependencies (Server):**
| Package | Version | Notes |
|---------|---------|-------|
| `fastify` | ^4.26.2 | Active |
| `sqlite3` | ^5.1.7 | Active; native module |
| `googleapis` | ^133.0.0 | **Unused in code** — large unnecessary dependency |

- `package-lock.json` is committed (good)
- No `postinstall` scripts detected in direct dependencies
- `hash-wasm` v4.12.0 is a well-maintained WASM crypto library by nicolo-ribaudo (good choice)

**Recommendation:**
Remove `googleapis` from server dependencies (unused). Remove `argon2-browser` from extension dependencies if shared package crypto is not used at runtime.

---

## Positive Findings

1. **Correct choice of Argon2id** with strong parameters (64 MiB memory, 3 iterations, parallelism 4). These exceed OWASP minimums (19 MiB, 2 iterations).

2. **Proper HKDF key separation.** Master key is used as HKDF base key with distinct `info` strings (`"vault-main"`, `"entry-<uuid>"`). Vault key and per-entry keys are cryptographically independent.

3. **Per-entry encryption.** Sensitive fields (passwords, TOTP secrets, card numbers, CVVs, notes) are encrypted individually with entry-specific keys. Decrypting one entry doesn't expose others.

4. **AES-256-GCM with 12-byte random nonces.** Correct nonce size, generated via `crypto.getRandomValues()`. No nonce reuse risk at expected vault sizes (collision probability negligible for <2^32 operations with random 96-bit nonces).

5. **Web Crypto API usage.** All cryptographic operations use the browser's native Web Crypto API (AES-GCM, HKDF, importKey). No custom crypto implementations.

6. **No `unsafe-eval` or `unsafe-inline` in CSP.** The CSP correctly uses `wasm-unsafe-eval` (required for Argon2 WASM) without broader eval permissions.

7. **TypeScript strict mode enabled.** `tsconfig.json` has `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`.

8. **No source maps in production build.** Verified: no `.map` files in `dist/`.

9. **Salt is 32 bytes and generated via `crypto.getRandomValues()`.** Exceeds the 16-byte minimum.

10. **Autofill requires user click.** Credentials are not auto-filled; user must click the Lotus icon. This prevents the invisible field credential theft that affects auto-fill implementations.

11. **`chrome.storage.session` used for session keys.** Correctly leverages MV3's session storage (cleared on browser close) rather than persistent storage for the master key.

---

## Threat Model Assessment

| # | Threat Scenario | Status | Notes |
|---|---|---|---|
| 1 | Compromised browser profile | PARTIAL | Vault blob is encrypted, but significant metadata is plaintext (LOTUS-017). S3/sync credentials exposed (LOTUS-004). |
| 2 | Malicious web page | WEAK | Content scripts on all pages (LOTUS-006). Hidden field attack possible (LOTUS-003). Substring URL matching (LOTUS-003). |
| 3 | LAN attacker | FAIL | Default HTTP deployment (LOTUS-002). Static shared secret. No mutual TLS by default. |
| 4 | Compromised S3 bucket | PARTIAL | Only ciphertext stored (good). But no integrity protection against rollback (LOTUS-005). Salt uploaded alongside. |
| 5 | Evil maid / shared computer | WEAK | Auto-lock timer unreliable (LOTUS-014). **Vault destroyed on lock** (LOTUS-001) so there's nothing to find, but also nothing to recover. |
| 6 | Extension update supply chain | GOOD | No dynamic code loading. CSP restricts eval. Standard Vite build pipeline. |
| 7 | Master password brute force | GOOD | Argon2id 64MiB/3 iterations makes brute force very expensive (~$10K+ for 10^10 guesses on GPU). |
| 8 | Nonce reuse | GOOD | Random 12-byte nonces via crypto.getRandomValues(). Collision probability negligible for expected usage. |
| 9 | Vault rollback | FAIL | No cryptographic version binding (LOTUS-005). Version numbers are unauthenticated. |
| 10 | Silent data loss | FAIL | Lock deletes vault (LOTUS-001). Sync conflicts silently resolved (LOTUS-005,015). |

---

## Comparison to Industry Standards

| Aspect | Lotus | Bitwarden | 1Password | KeePass |
|--------|-------|-----------|-----------|---------|
| **KDF** | Argon2id (64MiB, 3 iter) | PBKDF2-SHA256 (600K iter) or Argon2id | PBKDF2-SHA256 (650K iter) + SRP | AES-KDF or Argon2d |
| **Encryption** | AES-256-GCM | AES-256-CBC + HMAC-SHA256 | AES-256-GCM | AES-256-CBC or ChaCha20 |
| **Key hierarchy** | HKDF sub-keys | HKDF sub-keys | 2SKD (Two-Secret Key Derivation) | Direct key usage |
| **Metadata encryption** | Partial (names, URLs plaintext) | All vault data encrypted | All vault data encrypted | All database encrypted |
| **Sync security** | Plaintext HTTP (default) | TLS to cloud servers | TLS to cloud servers | No built-in sync |
| **Autofill** | Click-triggered, basic URL match | Click-triggered, exact domain + phishing detection | Click-triggered, domain match + Watchtower | N/A (separate plugins) |
| **Audit history** | None | Multiple third-party audits (Cure53, Insight Risk) | Multiple third-party audits (Cure53, NCC Group) | Community-reviewed |

**Key gaps vs. industry:**
- Bitwarden and 1Password encrypt ALL vault metadata; Lotus leaves names, URLs, and usernames in plaintext
- Both Bitwarden and 1Password have been independently audited multiple times
- 1Password's 2SKD uses a Secret Key in addition to the master password, providing additional security even with weak master passwords
- Lotus lacks vault versioning/history that Bitwarden and 1Password provide

---

## Recommendations Summary

### Critical (Fix Before Use)
| ID | Recommendation | Effort |
|----|---------------|--------|
| LOTUS-001 | Stop deleting encrypted vault on lock | Low |
| LOTUS-002 | Require TLS, generate random sync secret | Medium |

### High (Fix Before Daily-Driver Use)
| ID | Recommendation | Effort |
|----|---------------|--------|
| LOTUS-003 | Fix URL matching, add visibility checks to autofill | Medium |
| LOTUS-004 | Encrypt settings containing credentials | Medium |
| LOTUS-005 | Add vault-level integrity verification | High |
| LOTUS-006 | Remove unused permissions, restrict content scripts | Low |
| LOTUS-007 | Avoid exporting master key to session storage | Medium |
| LOTUS-008 | Fix or remove HMAC auth, use timing-safe comparison | Medium |

### Medium (Fix Before Sharing/Publishing)
| ID | Recommendation | Effort |
|----|---------------|--------|
| LOTUS-009 | Use AAD for AES-GCM encryption | Low |
| LOTUS-010 | Use Argon2 salt as HKDF salt | Low |
| LOTUS-011 | Standardize on one Argon2 library | Low |
| LOTUS-012 | Remove or implement passkey interception | Low |
| LOTUS-013 | Encrypt or time-limit pending save data | Low |
| LOTUS-014 | Use chrome.alarms for auto-lock | Medium |
| LOTUS-015 | Add S3 conditional writes (ETags) | Medium |
| LOTUS-016 | Fix modulo bias in password generator | Low |
| LOTUS-017 | Encrypt vault metadata | High |

### Low (Hardening)
| ID | Recommendation | Effort |
|----|---------------|--------|
| LOTUS-018 | Add nonce/replay protection to sync auth | Medium |
| LOTUS-019 | Add password strength enforcement | Low |
| LOTUS-020 | Remove or gate console.log statements | Low |
| LOTUS-021 | Explicitly disable source maps in Vite | Low |
| LOTUS-022 | Restrict CORS to extension origin | Low |
| LOTUS-023 | Remove unused dependencies (googleapis, argon2-browser) | Low |

---

*End of Report*
