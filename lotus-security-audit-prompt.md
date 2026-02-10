# Lotus Password Manager — Security Audit, Code Review & Stability Analysis Prompt

---

## Context

You are a senior security engineer and cryptography specialist conducting a formal audit of a self-hosted, zero-knowledge password manager
You are performing a comprehensive security audit, code review, and stability analysis of **Lotus**, a zero-knowledge password manager Chrome extension (Manifest V3) with LAN sync and S3 backup capabilities. The owner intends to use this as their **primary daily-driver password manager**, so the bar for security, reliability, and code quality is extremely high. Any flaw could result in credential exposure, data loss, or silent vault corruption.

The project stack is: React + TypeScript, Vite build system, Tailwind CSS + Radix UI, Web Crypto API, Argon2id (via WASM), WebSocket sync, S3-compatible storage sync, and `chrome.storage.local`/`chrome.storage.session` APIs.

Please review the entire codebase thoroughly and produce a structured report covering every section below. Be exhaustive. Do not soften findings — flag everything, even if speculative, and classify by severity.

---

## 1. Cryptographic Implementation Review

This is the most critical section. A password manager's entire value proposition rests on its cryptography being correct.

### 1.1 Key Derivation
- Review the Argon2id implementation (WASM binding). Are the parameters (memory cost, time cost, parallelism, salt length) aligned with current OWASP recommendations (minimum 19 MiB memory, 2 iterations, 1 degree of parallelism)?
- Is the salt generated using `crypto.getRandomValues()` with sufficient length (≥16 bytes)?
- Is the salt stored correctly and never reused across different master passwords or vault re-encryptions?
- Is there any fallback to PBKDF2? If so, under what conditions, and is this fallback adequately secure (≥600,000 iterations per OWASP 2023)?
- Is the derived key used directly, or is there a proper key separation scheme (e.g., separate keys for encryption vs. authentication vs. sync)?

### 1.2 Encryption (AES-GCM)
- Are IVs/nonces generated randomly using `crypto.getRandomValues()` and **never reused** with the same key? AES-GCM nonce reuse is catastrophic — verify this rigorously.
- What is the nonce length? (Should be 12 bytes / 96 bits for AES-GCM.)
- Is there a nonce counter or nonce tracking mechanism, or is it purely random? With random 96-bit nonces, what is the estimated collision probability given expected vault sizes and operation frequency? Is this acceptable?
- Is the authentication tag verified before any decryption output is used? Is there any path where decrypted plaintext is returned or acted upon despite a tag verification failure?
- Are there any encrypt-then-MAC vs. MAC-then-encrypt concerns, or does AES-GCM's integrated AEAD handle this cleanly?
- Is Additional Authenticated Data (AAD) used? If so, what is included? If not, should it be (e.g., to bind ciphertext to a specific entry ID or vault version)?

### 1.3 Key Lifecycle & Memory Handling
- How long does the derived encryption key persist in memory? Is it stored in `chrome.storage.session`, JavaScript variables, or both?
- Is the key properly cleared on vault lock, extension unload, and auto-lock timeout?
- Are there any code paths where the key or plaintext could leak into `console.log`, error messages, crash reports, or serialized state?
- Is there any use of `JSON.stringify()` or similar on objects containing sensitive material that could persist in memory or logs?
- Are `TypedArray` buffers (`Uint8Array`, `ArrayBuffer`) zeroed out after use where possible?

### 1.4 Master Password Handling
- Is the master password ever stored in plaintext anywhere — `localStorage`, `chrome.storage`, disk, or long-lived variables?
- Is it cleared from memory immediately after key derivation?
- Is there a master password strength meter or enforcement policy?
- Is there protection against brute-force attempts on the local vault (e.g., rate limiting, increasing Argon2 cost)?

---

## 2. Data Storage & Vault Integrity

### 2.1 Local Storage Security
- What exactly is stored in `chrome.storage.local`? Is it *only* ciphertext + metadata, or could any plaintext leak?
- What metadata is stored unencrypted (entry names, URLs, timestamps, tags)? Could this metadata alone reveal sensitive information?
- Is there integrity protection on the stored vault beyond AES-GCM's per-entry authentication? Could an attacker who gains access to `chrome.storage.local` delete entries, reorder them, or roll back to an older vault state without detection?
- Is there a vault-level MAC or hash that protects the overall vault structure?

### 2.2 Vault Corruption & Data Loss
- What happens if `chrome.storage.local` writes fail mid-operation (e.g., browser crash, extension update)?
- Is there any write-ahead log, atomic write mechanism, or journaling to prevent partial writes from corrupting the vault?
- Are there any automatic local backups before destructive operations (vault re-encryption, bulk delete, import)?
- What is the vault recovery path if the stored data becomes corrupted? Is there any checksum or integrity check on startup?

### 2.3 `chrome.storage.session` Usage
- What is stored in session storage? Is it only the derived key?
- `chrome.storage.session` is cleared when the browser closes — is this behavior relied upon for security? Are there edge cases where it persists (e.g., browser crash recovery, session restore)?
- Could another extension or compromised renderer process access `chrome.storage.session` data?

---

## 3. Synchronization Security

### 3.1 WebSocket (Local Server) Sync
- Is the WebSocket connection encrypted (WSS) or plaintext (WS)? If plaintext, this is a critical finding even on LAN — ARP spoofing, rogue devices, and compromised routers are real threats.
- How is the local server authenticated? Is there a shared secret, certificate pinning, or mutual TLS? Could any device on the LAN connect and pull vault data?
- What is sent over the WebSocket? Full encrypted vault blobs, or individual entry ciphertext? Could traffic analysis reveal vault size, number of entries, or operation patterns?
- Is there replay protection? Could a captured sync message be replayed to overwrite the vault with an older state?
- How does the "highest version wins" conflict resolution work? Could an attacker with network access force a version number rollback?
- Is the local server code included in this repo? If so, review it for injection, authentication bypass, and unauthorized access vulnerabilities.

### 3.2 S3 Sync
- How are S3 credentials stored? Are they encrypted at rest, or stored in plaintext in extension settings?
- Is the S3 transport always over HTTPS/TLS?
- What is uploaded to S3 — only the encrypted vault blob, or any plaintext metadata (bucket names, object keys that leak info)?
- Is there integrity verification when pulling from S3? Could a compromised S3 bucket serve a modified ciphertext blob that the extension would accept?
- With 30-second polling, what is the race condition window for conflicting writes? Could two devices polling simultaneously cause silent data loss?
- Is there versioning or ETag-based optimistic locking on S3 objects? What happens when a conditional put fails?

### 3.3 Dual Sync Consistency
- When both Local Server and S3 are active, is there a defined source of truth? What happens when they diverge?
- Could an attacker who compromises only one sync target (e.g., S3 bucket) inject a malicious vault that then propagates to all devices via the other sync channel?
- Are sync conflicts surfaced to the user, or silently resolved? Silent resolution in a password manager is dangerous.

---

## 4. Extension Security (Manifest V3 / Chrome APIs)

### 4.1 Permissions & Attack Surface
- List all permissions in `manifest.json`. Are any overly broad? Does the extension request `<all_urls>`, `tabs`, `webRequest`, or other high-risk permissions? Are all permissions justified?
- Is the Content Security Policy (CSP) correctly configured? Is `unsafe-eval` or `unsafe-inline` present? (These would be significant findings.)
- Review the content script (`autofill.ts`): Does it inject into all pages? Could a malicious page interact with the content script to extract vault data or trigger autofill to the wrong fields?

### 4.2 Autofill Security
- How does the autofill system identify which credentials to fill? Is it purely URL-based, and if so, is the URL matching robust against subdomain attacks, path confusion, or IDN homograph attacks?
- Could a malicious page create hidden form fields that trick autofill into filling credentials into attacker-controlled inputs?
- Is autofill triggered automatically or only on user interaction? Automatic autofill is a known attack vector (see: autofill credential theft via invisible fields).
- Is there phishing protection (e.g., warning when filling credentials on a domain that doesn't match the saved entry)?

### 4.3 Inter-Process Communication
- How do the popup, background service worker, and content scripts communicate? Is `chrome.runtime.sendMessage` used? Are message origins validated?
- Could a compromised or malicious web page send messages to the extension's background script?
- Are there any `externally_connectable` entries that could allow external websites to communicate with the extension?

---

## 5. Code Quality & Reliability

### 5.1 TypeScript & Type Safety
- Are there any uses of `any`, type assertions (`as`), or `@ts-ignore` that bypass type checking in security-critical code paths?
- Is strict mode enabled in `tsconfig.json`? (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`)
- Are crypto-related functions properly typed (key material as `CryptoKey`, not `string` or `any`)?

### 5.2 Error Handling
- What happens when decryption fails? Is the error caught gracefully, or could it crash the extension / corrupt state?
- Are there any bare `catch` blocks that swallow errors silently, especially in sync or crypto code?
- Do error messages ever include sensitive data (key material, plaintext, master password)?
- What is the user experience when sync fails? Is the failure visible, or could the user believe their vault is synced when it isn't?

### 5.3 State Management
- Is the `VaultContext` implementation sound? Are there race conditions when multiple async operations (decrypt, sync, save) run concurrently?
- Could rapid user actions (quick add/edit/delete) cause state corruption?
- Is there proper cleanup on component unmount (dangling promises, orphaned WebSocket connections, timers)?
- Review the auto-lock timer: Is it resilient to system sleep/wake, clock changes, and long browser inactivity?

### 5.4 Dependencies & Supply Chain
- List all direct and transitive npm dependencies. Flag any that are unmaintained (no updates in 12+ months), have known vulnerabilities, or are unnecessarily large.
- Is the Argon2id WASM module sourced from a reputable, audited implementation? Which one?
- Is `package-lock.json` committed and used for reproducible builds?
- Are there any post-install scripts in dependencies that could execute arbitrary code?

### 5.5 Build & Distribution
- Is the Vite build configuration secure? Are source maps disabled for production builds? (Source maps in a published extension leak the entire source.)
- Is there a clear build-to-publish pipeline, or could the distributed `.crx`/`.zip` diverge from the source?

---

## 6. Threat Model Assessment

Given the architecture described, evaluate the following threat scenarios and assess whether Lotus has adequate protections:

| # | Threat Scenario | Expected Mitigation |
|---|---|---|
| 1 | **Compromised browser profile** — attacker has read access to `chrome.storage.local` | Vault must be indistinguishable from random data without master password |
| 2 | **Malicious web page** — page attempts to extract credentials via content script interaction | Content script must not expose any vault data to page context |
| 3 | **LAN attacker** — device on same network attempts to intercept or inject sync data | Sync must be encrypted and authenticated; server must require auth |
| 4 | **Compromised S3 bucket** — attacker can read/write S3 objects | Only ciphertext should be stored; injected blobs must not corrupt local vault |
| 5 | **Evil maid / shared computer** — someone accesses unlocked browser while user is away | Auto-lock must work reliably; no plaintext in persistent storage |
| 6 | **Extension update supply chain** — malicious update pushed to extension | Signing, CSP, and absence of dynamic code loading mitigate this |
| 7 | **Master password brute force** — offline attack on stored vault | Argon2id parameters must make brute force infeasible |
| 8 | **Nonce reuse** — cryptographic failure in IV generation | Nonces must be random, unique, and properly sized |
| 9 | **Vault rollback** — attacker replays an older vault version via sync | Version vectors or authenticated sequencing must prevent this |
| 10 | **Silent data loss** — sync conflict causes entries to disappear | Conflicts must be surfaced to user; no silent overwrites |

---

## 7. Comparison to Industry Standards

Briefly compare Lotus's architecture to established password managers (Bitwarden, 1Password, KeePass) on:
- Key derivation parameters and approach
- Encryption scheme and key hierarchy
- Sync security model
- Autofill security model
- Audit history (have similar architectures been independently audited?)

Identify any areas where Lotus's approach is weaker or non-standard compared to these established tools.

---

## 8. Report Format

Please structure your findings as follows:

### Summary
- Overall risk rating (Critical / High / Medium / Low) with rationale.
- Top 3-5 findings that must be fixed before daily-driver use.
- Overall assessment: Is this vault trustworthy for storing real credentials today?

### Detailed Findings
For each finding, provide:
- **ID**: Sequential (e.g., LOTUS-001)
- **Severity**: Critical / High / Medium / Low / Informational
- **Category**: Cryptography, Storage, Sync, Extension Security, Code Quality, Reliability
- **Title**: One-line summary
- **Description**: What was found
- **Impact**: What could go wrong
- **Recommendation**: How to fix it
- **Code Reference**: File and line number(s) if applicable

### Positive Findings
List things the project does well — good security practices, solid design decisions, etc.

### Recommendations Summary
Prioritized list of all recommendations, grouped by severity, with estimated effort (Low / Medium / High).

---

**Important**: Do not assume anything is correct — verify it in the code. "The README says it uses Argon2id" is not evidence; finding the actual Argon2id call with correct parameters in the source code is. If you cannot find evidence of a claimed security feature in the actual implementation, flag it as a finding.
