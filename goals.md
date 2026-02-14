# Peach Password Manager - Strategic Goals

## Vision
Build the best password manager with seamless user experience that rivals and exceeds Bitwarden.

## Current Status
✅ PGP Import Fixes - Complete
✅ Bitwarden-Inspired Autofill Architecture (All 5 Phases) - Complete
✅ Shadow DOM Support - Complete
✅ Comprehensive Test Suite - Complete

---

## How to Rival & Exceed Bitwarden

### 1. Where Bitwarden Excels (Our Baseline)
- Battle-tested autofill on 10,000+ sites
- Cross-platform sync (though we have S3 sync)
- Open source transparency
- Established user base

### 2. Where We Can Dominate

#### A. Technical Superiority
- **Better Shadow DOM Support**: Bitwarden struggles with Web Components (Lit, Stencil). Our new architecture handles this natively.
- **Smarter Field Detection**: Our weighted scoring system is more sophisticated than Bitwarden's heuristic approach.
- **P2P Sync**: Bitwarden requires their cloud. We have zero-knowledge local + S3 + P2P options.

#### B. UX Innovations Bitwarden Lacks
- **Contextual Autofill**: Fill only what the user needs (username OR password based on field focus)
- **Inline Biometric**: Touch ID for individual autofill actions, not just vault unlock
- **Smart Merge**: We already have better merge conflict resolution
- **Import Excellence**: We now rival 1Password/Bitwarden import quality

#### C. Developer/Enterprise Features
- **Self-Hosted First**: Unlike Bitwarden's "self-hosted as an afterthought"
- **Audit Logging**: Enterprise-grade event tracking
- **API-First**: Every feature accessible programmatically

---

## Roadmap

### Immediate Goals (Next 2-4 weeks)

1. **Autofill Quality Testing**
   - Run automated tests against Alexa Top 1000 sites
   - Measure success rate, time-to-fill, false positives
   - Target: >98% success rate, <500ms time-to-fill

2. **Passkey/WebAuthn Leadership**
   - Implement full passkey management
   - Support creation, storage, and autofill of passkeys
   - Target: Better than Bitwarden's current implementation

3. **Android Extension** ⚠️ *Requires Special Planning*
   - See detailed plan below
   - Goal: Fluid, faithful port of browser extension
   - Must maintain zero-knowledge architecture

4. **Performance Optimization**
   - Profile autofill execution time
   - Optimize Shadow DOM traversal
   - Reduce bundle size
   - Target: Faster than Bitwarden

### Medium-term Goals (1-3 months)

5. **AI-Powered Form Detection**
   - Train lightweight model on form patterns
   - Better than regex-based detection
   - Offline inference (privacy-preserving)

6. **Automatic TOTP Detection**
   - Detect QR codes on screen
   - Offer to save TOTP secrets
   - One-click setup

7. **Secure Sharing**
   - P2P encrypted credential sharing
   - No server involved
   - End-to-end encrypted

8. **Breach Monitoring**
   - Integration with Have I Been Pwned APIs
   - Real-time notifications
   - Password health dashboard

### Long-term Differentiators (3-6 months)

9. **Browser-Native Feel**
   - Extension feels like native browser feature
   - Not an add-on, but integrated
   - System-level integration where possible

10. **Zero-Click Autofill**
    - Optional automatic fill on trusted sites
    - Biometric fallback for security
    - User-controlled per-site settings

11. **Credential Cloning**
    - Smart detection of password changes
    - Automatic update prompts
    - Change password assistance

12. **Enterprise SSO Bridge**
    - Use Peach as SSO provider for internal tools
    - SAML/OIDC support
    - Directory integration

13. **Hardware Security Key Management**
    - Better YubiKey/BioPass integration
    - FIDO2/WebAuthn support
    - Hardware-backed encryption

---

## Success Metrics

- **Autofill Success Rate**: >98% on top 1000 sites
- **Time-to-Fill**: <500ms from page load
- **False Positive Rate**: <2% (suggesting on non-login fields)
- **User Retention**: 30-day >70%, 90-day >50%
- **Extension Performance**: Bundle size <2MB, load time <100ms
- **Test Coverage**: >80% for core autofill modules

---

## Android Extension Strategy

### The Challenge
Previous attempts have failed. We need a fundamentally different approach.

### Core Requirements
- Must maintain zero-knowledge architecture
- Must use same crypto (Argon2id, AES-GCM)
- Must support autofill framework
- Must sync with existing S3/P2P infrastructure

### Technical Approach

#### Option 1: Native Android App with WebView Bridge
**Pros:**
- Full access to Android Autofill Framework
- Native performance
- Can reuse crypto logic via Rust/WASM

**Cons:**
- Requires significant native Android development
- Two codebases to maintain

**Architecture:**
```
Native Android App (Kotlin)
├── Autofill Service (Android Autofill Framework)
├── WebView for UI (reuse React components)
├── Rust/WASM crypto module (shared with extension)
└── Sync layer (S3 + P2P via native networking)
```

#### Option 2: Progressive Web App (PWA) with Trusted Web Activity
**Pros:**
- Single codebase
- Can be published to Play Store
- Uses same web crypto

**Cons:**
- Limited access to Android Autofill Framework
- May require native bridge for autofill

**Architecture:**
```
Trusted Web Activity
├── PWA with existing React UI
├── Native Autofill Bridge (minimal Kotlin)
├── Web Crypto API (same as extension)
└── Background sync via Service Worker
```

#### Option 3: React Native with Shared Crypto Module
**Pros:**
- Native performance
- Shared business logic
- Good autofill support

**Cons:**
- React Native complexity
- Crypto module challenges

### Recommended Approach: Hybrid Model

After analysis, recommend **Option 1 (Native + WebView Bridge)** with the following specifics:

#### Phase 1: Foundation (Week 1-2)
1. Create native Android project with Autofill Service
2. Set up Rust/WASM bridge for shared crypto
3. Port core vault logic to Kotlin/Rust
4. Implement basic unlock/lock flow

#### Phase 2: UI Integration (Week 3-4)
1. WebView with existing React components
2. Message bridge between native and web
3. Implement settings, vault view, entry editing
4. Ensure offline functionality

#### Phase 3: Autofill (Week 5-6)
1. Android Autofill Framework integration
2. Field detection using same scoring algorithm
3. Inline presentation (like existing inline-menu.ts)
4. Biometric unlock integration

#### Phase 4: Sync (Week 7-8)
1. S3 sync implementation (AWS SDK for Android)
2. P2P sync via WebRTC or native implementation
3. Conflict resolution (reuse existing logic)
4. Background sync optimization

#### Phase 5: Polish (Week 9-10)
1. Performance optimization
2. Battery usage optimization
3. Error handling and recovery
4. Beta testing

### Key Technical Decisions

1. **Crypto**: Use Rust with JNI bridge (same WASM module compiled for Android)
2. **Storage**: Encrypted SharedPreferences for metadata, encrypted files for vault
3. **Sync**: Reuse existing S3/P2P logic, adapt for Android lifecycle
4. **Autofill**: Full Android Autofill Service implementation
5. **UI**: WebView with existing React components to maintain consistency

### Critical Success Factors

1. **Zero-Knowledge**: Master key never leaves secure hardware (Android Keystore)
2. **Performance**: Unlock in <2 seconds on mid-range device
3. **Battery**: Background sync must be efficient
4. **Compatibility**: Support Android 10+ (API 29+)
5. **Faithfulness**: Feature parity with browser extension

---

## Next Steps

### This Session
- [ ] Implement autofill quality testing framework
- [ ] Set up passkey/WebAuthn support structure
- [ ] Create Android project foundation

### Next 2 Weeks
- [ ] Run autofill tests against top sites
- [ ] Fix any detection failures
- [ ] Begin Android Phase 1

### Decision Points
1. Which immediate goal should we tackle first?
2. Do you agree with the Android hybrid approach?
3. Should we prioritize passkeys over Android initially?

---

## Notes

- Bitwarden is the "safe choice" — reliable but boring
- We win on: Speed, Intelligence, Beauty, Philosophy
- Keep zero-knowledge as non-negotiable constraint
- Maintain UI/UX excellence across all platforms
