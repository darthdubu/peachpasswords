# P2P Sync Foundation Design Document

## Overview

This document describes the secure peer-to-peer (P2P) synchronization protocol for Lotus Password Manager. The P2P sync feature enables users to synchronize their encrypted vault data directly between devices without relying on cloud storage, using WebRTC data channels with end-to-end encryption via the Noise Protocol.

### Goals

- **Direct Device-to-Device Sync**: Enable vault synchronization between paired devices without intermediary cloud storage
- **End-to-End Encryption**: Ensure all vault data is encrypted end-to-end, independent of WebRTC's DTLS transport
- **Mutual Authentication**: Verify the identity of both peers using cryptographic keys exchanged during initial pairing
- **Perfect Forward Secrecy**: Protect past communications from future key compromises
- **Minimal Trust in Signaling Server**: The pairing/signaling server should only relay opaque signaling messages and have no access to vault data or encryption keys

### Architecture Overview

```
┌─────────────┐                    ┌─────────────┐
│   Device A  │                    │   Device B  │
│  (Initiator)│                    │ (Responder) │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. Pairing & Key Exchange        │
       │    (via QR code, manual entry,   │
       │     or pairing server)           │
       │◄────────────────────────────────►│
       │    • Static public keys          │
       │    • Preshared pairing token     │
       │                                  │
       │ 2. Signaling (WebRTC)            │
       │    (via pairing server)          │
       │◄────────────────────────────────►│
       │    • Opaque SDP offers/answers   │
       │    • ICE candidates              │
       │                                  │
       │ 3. Data Channel                  │
       │    (WebRTC + Noise XX)           │
       │◄════════════════════════════════►│
       │    • Noise handshake (XX)        │
       │    • Encrypted vault sync        │
       │                                  │
```

---

## Security Requirements

### 1. Noise Protocol XX Pattern for Handshake

The XX pattern is a Noise handshake pattern that provides:
- **Mutual authentication**: Both peers authenticate each other
- **Forward secrecy**: Compromised long-term keys don't compromise past sessions
- **Identity hiding**: Ephemeral keys are exchanged before static keys

### 2. Pairing Server as Opaque Relay

The pairing/signaling server:
- **MUST ONLY** relay opaque signaling messages (SDP offers, SDP answers, ICE candidates)
- **MUST NOT** have access to vault data or decryption keys
- **MUST NOT** be able to modify or inspect the content of encrypted data channels
- **MUST** authenticate clients before allowing signaling

### 3. Public Key Verification

- Each device generates a static Ed25519 key pair during initialization
- Public keys are exchanged during the initial pairing process
- During Noise handshake, received static public keys MUST be verified against the stored keys from initial pairing
- Failed verification MUST terminate the connection

### 4. End-to-End Encryption

- All vault data transferred over the data channel MUST be encrypted using Noise's CipherState
- Encryption MUST be independent of WebRTC's built-in DTLS/SRTP
- Each sync session uses unique ephemeral keys for forward secrecy
- Encryption covers both message payload and metadata (message types, sizes are obscured)

### 5. Perfect Forward Secrecy

- Each sync session generates new ephemeral X25519 key pairs
- Session keys are ephemeral and never persisted
- Compromise of a device's static key does not compromise past session contents

---

## Noise Protocol XX Pattern

### Pattern Explanation

The XX pattern is defined as:
```
XX:
  -> e
  <- e, ee, s, es
  -> s, se
```

Where:
- `e` = ephemeral public key
- `s` = static public key
- `ee` = ECDH between ephemeral keys
- `es` = ECDH between initiator's ephemeral and responder's static
- `se` = ECDH between initiator's static and responder's ephemeral

### Message Breakdown

| Message | Sender | Contents | Operations |
|---------|--------|----------|------------|
| e1 | Initiator | Ephemeral public key | `MixHash(e1.public_key)` |
| e2, s2 | Responder | Ephemeral + static public key, payload | `MixHash(e2.public_key)`, `MixKey(ECDH(e1, e2))`, `MixKey(ECDH(e1, s2))`, EncryptAndHash(payload) |
| s1 | Initiator | Static public key, payload | `MixKey(ECDH(s1, e2))`, EncryptAndHash(payload) |

### Security Properties

| Property | XX Pattern |
|----------|------------|
| Initiator authentication | 3 (mutual) |
| Responder authentication | 3 (mutual) |
| Initiator identity hiding | 2 (from passive observers) |
| Responder identity hiding | 2 (from passive observers) |
| Forward secrecy | 3 (for both parties) |

*Scale: 0=none, 1=partial, 2=good, 3=excellent*

---

## Protocol Design

### Handshake Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INITIAL STATE                                       │
│                                                                             │
│  Initiator (Device A)                       Responder (Device B)            │
│  ─────────────────────                      ─────────────────────           │
│  Static key: sA (Ed25519)                   Static key: sB (Ed25519)        │
│  Ephemeral: eA (X25519)                     Ephemeral: eB (X25519)          │
│  Known: sB (from pairing)                   Known: sA (from pairing)        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebRTC Data Channel Established
                                    │ (DTLS handshake complete - transport only)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NOISE HANDSHAKE                                     │
└─────────────────────────────────────────────────────────────────────────────┘

Message 1 (Initiator → Responder):
───────────────────────────────────
┌─────────────────────────────────────────────────────────────────────────┐
│  eA.public_key (32 bytes, X25519)                                       │
│  [plaintext - no payload]                                               │
└─────────────────────────────────────────────────────────────────────────┘
  • Initiator generates ephemeral key pair eA
  • Sends eA.public_key to responder
  • Initializes Noise handshake state

                                    │
                                    ▼

Message 2 (Responder → Initiator):
───────────────────────────────────
┌─────────────────────────────────────────────────────────────────────────┐
│  eB.public_key (32 bytes)                                               │
│  Encrypted payload:                                                     │
│    • sB.public_key (32 bytes, encrypted)                                │
│    • Authenticated data: pairing verification token                     │
└─────────────────────────────────────────────────────────────────────────┘
  • Responder generates ephemeral key pair eB
  • Performs ECDH(eA, eB) → mixes into key material
  • Performs ECDH(eA, sB) → mixes into key material
  • Encrypts static public key sB with current CipherState
  • Initiator verifies decrypted sB against stored key from pairing

                                    │
                                    ▼

Message 3 (Initiator → Responder):
───────────────────────────────────
┌─────────────────────────────────────────────────────────────────────────┐
│  Encrypted payload:                                                     │
│    • sA.public_key (32 bytes, encrypted)                                │
│    • Authenticated data: pairing verification token                     │
└─────────────────────────────────────────────────────────────────────────┘
  • Initiator performs ECDH(sA, eB) → mixes into key material
  • Encrypts static public key sA with current CipherState
  • Responder verifies decrypted sA against stored key from pairing

                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      HANDSHAKE COMPLETE                                     │
│                                                                             │
│  Both parties have:                                                         │
│  • Authenticated each other's static keys                                   │
│  • Derived shared symmetric keys for encryption                             │
│  • Split CipherState into send/receive keys                                 │
│                                                                             │
│  Split() → (CipherState_send, CipherState_receive)                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Message Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               P2P SYNC PROTOCOL FLOW                                    │
└────────────────────────────────────────────────────────────────────────────────────────┘

PHASE 1: PAIRING (One-time setup)
════════════════════════════════════════════════════════════════════════════════════════

  Device A                                    Pairing Server                    Device B
     │                                               │                              │
     │  Display QR code containing:                  │                              │
     │  • sA.public_key (Ed25519)                    │                              │
     │  • Pairing token (random 256-bit)             │                              │
     │◄──────────────────────────────────────────────┼─────────────────────────────►│
     │                                               │                   Scan QR code
     │                                               │                   Store sA, token
     │                                               │                              │
     │  Manual entry or server-assisted pairing      │                              │
     │◄──────────────────────────────────────────────┼─────────────────────────────►│
     │  Exchange: sA, sB, pairing token              │                              │


PHASE 2: SIGNALING (Per-sync session)
════════════════════════════════════════════════════════════════════════════════════════

  Device A                                    Signaling Server                  Device B
     │                                               │                              │
     │  POST /signaling/authenticate                │                              │
     │  { device_id, signature challenge }           │                              │
     │──────────────────────────────────────────────►│                              │
     │  { session_token }                            │                              │
     │◄──────────────────────────────────────────────│                              │
     │                                               │                              │
     │  POST /signaling/offer                        │                              │
     │  { encrypted_sdp_offer, target_device_id }    │                              │
     │──────────────────────────────────────────────►│  POST /signaling/poll        │
     │                                               │◄─────────────────────────────│
     │                                               │  { pending_offers[] }        │
     │                                               │  [sB decrypts, gets offer]   │
     │                                               │                              │
     │                                               │  POST /signaling/answer      │
     │                                               │  { encrypted_sdp_answer }    │
     │  GET /signaling/poll                          │◄─────────────────────────────│
     │◄──────────────────────────────────────────────│                              │
     │  { encrypted_sdp_answer }                     │                              │
     │  [sA decrypts, gets answer]                   │                              │
     │                                               │                              │
     │  [ICE candidate exchange continues...]        │                              │


PHASE 3: DATA CHANNEL + NOISE HANDSHAKE
════════════════════════════════════════════════════════════════════════════════════════

  Device A (Initiator)                                                      Device B (Responder)
     │                                                                              │
     │  ┌─────────────────────────────────────────────────────────────────────────┐  │
     │  │           WEBRTC DATA CHANNEL ESTABLISHED (DTLS)                        │  │
     │  └─────────────────────────────────────────────────────────────────────────┘  │
     │                                                                              │
     │  NOISE HANDSHAKE MESSAGE 1                                                   │
     │  ─────────────────────────                                                   │
     │  Send: eA.public_key ───────────────────────────────────────────────────────►│
     │                                                          [Initialize state]  │
     │                                                          [MixHash(eA)]       │
     │                                                                              │
     │                                                          Generate eB         │
     │                                                          ECDH(eA, eB)        │
     │                                                          ECDH(eA, sB)        │
     │  NOISE HANDSHAKE MESSAGE 2                                                   │
     │  ─────────────────────────                                                   │
     │  ◄──────────────────────────────────────────────────── Send: eB, Enc(sB)     │
     │  [Verify sB against stored key]                                              │
     │  [MixHash(eB), MixKey(ee), MixKey(es)]                                       │
     │  [Decrypt and verify sB]                                                     │
     │                                                                              │
     │  ECDH(sA, eB)                                                                │
     │  NOISE HANDSHAKE MESSAGE 3                                                   │
     │  ─────────────────────────                                                   │
     │  Send: Enc(sA) ─────────────────────────────────────────────────────────────►│
     │  [MixKey(se)]                                                                │
     │                                                          [Decrypt sA]        │
     │                                                          [Verify sA]         │
     │                                                          [MixKey(se)]        │
     │                                                                              │
     │  ┌─────────────────────────────────────────────────────────────────────────┐  │
     │  │           NOISE HANDSHAKE COMPLETE                                      │  │
     │  │  Split() → (send_key, receive_key)                                      │  │
     │  └─────────────────────────────────────────────────────────────────────────┘  │
     │                                                                              │
     │  ENCRYPTED DATA TRANSFER                                                     │
     │  ─────────────────────                                                       │
     │  Send: Enc(vault_sync_message) ─────────────────────────────────────────────►│
     │  Send: Enc(vault_sync_message) ◄─────────────────────────────────────────────│
     │  ...                                                                         │


PHASE 4: SESSION TERMINATION
════════════════════════════════════════════════════════════════════════════════════════

  • Cipher states zeroed from memory
  • Session keys never persisted
  • WebRTC connection closed
  • New sync = new ephemeral keys + new handshake
```

---

## Implementation Guidelines

### WebRTC Data Channel Setup

```typescript
// Simplified implementation structure
interface P2PSyncConfig {
  // ICE servers - can include TURN for NAT traversal
  iceServers: RTCIceServer[];
  
  // Signaling server endpoint
  signalingEndpoint: string;
  
  // Local static key (Ed25519 for signatures, converted to X25519 for Noise)
  staticKeyPair: Ed25519KeyPair;
  
  // Remote peer's static public key (from pairing)
  remoteStaticPublicKey: Uint8Array;
  
  // Pairing verification token
  pairingToken: Uint8Array;
}

class P2PSyncSession {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel;
  private noiseState: NoiseState;
  
  async initializeConnection(config: P2PSyncConfig): Promise<void> {
    // 1. Create peer connection
    this.pc = new RTCPeerConnection({
      iceServers: config.iceServers,
      // Force DTLS for transport security (additional layer)
      iceTransportPolicy: 'all'
    });
    
    // 2. Create data channel with ordered, reliable delivery
    this.dataChannel = this.pc.createDataChannel('vault-sync', {
      ordered: true,
      maxRetransmits: null // Reliable mode
    });
    
    // 3. Set up data channel event handlers
    this.setupDataChannelHandlers();
    
    // 4. Perform signaling exchange
    await this.performSignaling(config);
    
    // 5. Once data channel opens, initiate Noise handshake
    this.dataChannel.onopen = () => {
      this.initiateNoiseHandshake(config);
    };
  }
}
```

### Noise Protocol Integration

```typescript
// Using a Noise library (e.g., noise-c.wasm, noise-js, or native implementation)

class NoiseHandshake {
  private state: NoiseHandshakeState;
  private config: NoiseConfig;
  
  constructor(
    private staticKeyPair: X25519KeyPair,  // Converted from Ed25519
    private remoteStaticPublicKey: Uint8Array,
    private pairingToken: Uint8Array,
    private isInitiator: boolean
  ) {
    // Initialize Noise state for XX pattern
    this.state = noise.HandshakeState('Noise_XX_25519_ChaChaPoly_BLAKE2s');
    
    // Set static key (pre-converted from Ed25519 to X25519 if needed)
    this.state.setStaticKey(staticKeyPair.privateKey);
  }
  
  // Initiator: Create first message (e)
  createMessage1(): Uint8Array {
    if (!this.isInitiator) {
      throw new Error('Only initiator sends message 1');
    }
    
    // Generate ephemeral key pair internally
    this.state.generateEphemeralKey();
    
    // Write message: -> e
    const message = this.state.writeMessage(null); // No payload in first message
    
    return message;
  }
  
  // Responder: Read first message and create second message (e, ee, s, es)
  handleMessage1AndCreateMessage2(message1: Uint8Array): Uint8Array {
    if (this.isInitiator) {
      throw new Error('Only responder handles message 1');
    }
    
    // Read message: -> e
    this.state.readMessage(message1, null);
    
    // Generate our ephemeral key
    this.state.generateEphemeralKey();
    
    // Create payload: encrypted static key + pairing token
    const payload = this.createAuthPayload();
    
    // Write message: <- e, ee, s, es
    const message2 = this.state.writeMessage(payload);
    
    return message2;
  }
  
  // Initiator: Read message 2 and create message 3 (s, se)
  handleMessage2AndCreateMessage3(message2: Uint8Array): Uint8Array {
    if (!this.isInitiator) {
      throw new Error('Only initiator handles message 2');
    }
    
    // Read message and get decrypted payload
    const payload = this.state.readMessage(message2);
    
    // Verify remote static key and pairing token
    this.verifyAuthPayload(payload);
    
    // Create our auth payload
    const ourPayload = this.createAuthPayload();
    
    // Write message: -> s, se
    const message3 = this.state.writeMessage(ourPayload);
    
    return message3;
  }
  
  // Responder: Read message 3 and complete handshake
  handleMessage3(message3: Uint8Array): CipherStates {
    if (this.isInitiator) {
      throw new Error('Only responder handles message 3');
    }
    
    // Read message and verify
    const payload = this.state.readMessage(message3);
    this.verifyAuthPayload(payload);
    
    // Split into send/receive cipher states
    return this.state.split();
  }
  
  // Create authentication payload
  private createAuthPayload(): Uint8Array {
    // Structure:
    // [0:32]  Static public key (X25519)
    // [32:64] Pairing token (first 32 bytes of BLAKE2s of token)
    // [64:80] Timestamp/nonce for replay protection
    
    const payload = new Uint8Array(80);
    payload.set(this.staticKeyPair.publicKey, 0);
    payload.set(blake2s(this.pairingToken, 32), 32);
    payload.set(getTimestampBytes(), 64);
    
    return payload;
  }
  
  // Verify authentication payload
  private verifyAuthPayload(payload: Uint8Array): void {
    const receivedPubKey = payload.slice(0, 32);
    const receivedTokenHash = payload.slice(32, 64);
    const timestamp = payload.slice(64, 80);
    
    // Verify static public key matches expected
    if (!constantTimeEqual(receivedPubKey, this.remoteStaticPublicKey)) {
      throw new AuthenticationError('Remote public key mismatch');
    }
    
    // Verify pairing token hash
    const expectedTokenHash = blake2s(this.pairingToken, 32);
    if (!constantTimeEqual(receivedTokenHash, expectedTokenHash)) {
      throw new AuthenticationError('Pairing token mismatch');
    }
    
    // Verify timestamp for replay protection (optional, ±5 min window)
    this.verifyTimestamp(timestamp);
  }
}
```

### Key Exchange During Pairing

```typescript
interface PairingExchange {
  // Device A generates and displays
  generatePairingBundle(): PairingBundle {
    const staticKey = generateEd25519KeyPair();
    const pairingToken = randomBytes(32);
    
    // Store in secure storage
    secureStorage.set('p2p_static_key', staticKey);
    secureStorage.set('pairing_token', pairingToken);
    
    return {
      publicKey: staticKey.publicKey,      // 32 bytes Ed25519
      pairingToken: pairingToken,           // 32 bytes random
      // Encoded as QR code or short code for manual entry
      encoded: encodeForQR(staticKey.publicKey, pairingToken)
    };
  }
  
  // Device B scans and completes pairing
  completePairing(bundle: PairingBundle): void {
    // Generate our own key pair
    const ourStaticKey = generateEd25519KeyPair();
    
    // Store peer's info
    secureStorage.set('peer_public_key', bundle.publicKey);
    secureStorage.set('pairing_token', bundle.pairingToken);
    secureStorage.set('our_static_key', ourStaticKey);
    
    // Optionally: Send our public key back to Device A
    // through the same channel (server-assisted or visual)
  }
}

// For Noise XX, we need X25519 keys
// Convert Ed25519 to X25519 for Noise operations
function convertEd25519ToX25519(ed25519Key: Uint8Array): Uint8Array {
  // Use standard conversion: X25519 private key from Ed25519 private key
  // X25519 public key via point conversion
  return ed25519ToX25519(ed25519Key);
}
```

### Message Encryption/Decryption

```typescript
interface EncryptedMessage {
  nonce: Uint8Array;      // 12 bytes for ChaCha20
  ciphertext: Uint8Array; // Encrypted payload + tag
}

class P2PEncryptedChannel {
  private sendCipher: CipherState;
  private receiveCipher: CipherState;
  private messageCounter: number = 0;
  
  constructor(cipherStates: { send: CipherState; receive: CipherState }) {
    this.sendCipher = cipherStates.send;
    this.receiveCipher = cipherStates.receive;
  }
  
  // Encrypt and send a vault sync message
  async send(message: VaultSyncMessage): Promise<void> {
    // Serialize the message
    const plaintext = encodeVaultMessage(message);
    
    // Encrypt with Noise CipherState (ChaCha20-Poly1305)
    // Noise handles nonce management internally via rekeying
    const ciphertext = this.sendCipher.encryptWithAd(null, plaintext);
    
    // Add length prefix for framing (4 bytes, big-endian)
    const frame = new Uint8Array(4 + ciphertext.length);
    new DataView(frame.buffer).setUint32(0, ciphertext.length, false);
    frame.set(ciphertext, 4);
    
    // Send via WebRTC data channel
    this.dataChannel.send(frame);
    
    // Periodic rekeying (every N messages or time interval)
    this.messageCounter++;
    if (this.messageCounter % 1000 === 0) {
      this.sendCipher.rekey();
    }
  }
  
  // Receive and decrypt a message
  onDataChannelMessage(frame: ArrayBuffer): void {
    const view = new DataView(frame);
    const length = view.getUint32(0, false);
    const ciphertext = new Uint8Array(frame, 4, length);
    
    // Decrypt with Noise CipherState
    const plaintext = this.receiveCipher.decryptWithAd(null, ciphertext);
    
    // Parse and process
    const message = decodeVaultMessage(plaintext);
    this.handleVaultMessage(message);
  }
}

// Vault sync message types
interface VaultSyncMessage {
  type: 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'CHANGE_SET' | 'ACK' | 'ERROR';
  timestamp: number;
  payload: Uint8Array; // Application-defined, may contain encrypted vault data
}
```

### Error Handling

```typescript
enum P2PErrorCode {
  // Noise handshake errors
  HANDSHAKE_FAILED = 'HANDSHAKE_FAILED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  PUBLIC_KEY_MISMATCH = 'PUBLIC_KEY_MISMATCH',
  PAIRING_TOKEN_INVALID = 'PAIRING_TOKEN_INVALID',
  REPLAY_DETECTED = 'REPLAY_DETECTED',
  
  // WebRTC errors
  SIGNALING_FAILED = 'SIGNALING_FAILED',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  DATA_CHANNEL_CLOSED = 'DATA_CHANNEL_CLOSED',
  
  // Encryption errors
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  MESSAGE_CORRUPTED = 'MESSAGE_CORRUPTED',
  REKEY_REQUIRED = 'REKEY_REQUIRED',
  
  // Protocol errors
  TIMEOUT = 'TIMEOUT',
  PROTOCOL_VIOLATION = 'PROTOCOL_VIOLATION'
}

class P2PSyncError extends Error {
  constructor(
    public code: P2PErrorCode,
    public message: string,
    public recoverable: boolean = false
  ) {
    super(message);
  }
}

// Error handling strategy
class P2PErrorHandler {
  handleError(error: P2PSyncError): void {
    switch (error.code) {
      case P2PErrorCode.AUTHENTICATION_FAILED:
      case P2PErrorCode.PUBLIC_KEY_MISMATCH:
        // Security critical - terminate and alert user
        this.terminateConnection();
        this.alertUser('Security verification failed. Possible MITM attack.');
        break;
        
      case P2PErrorCode.HANDSHAKE_FAILED:
        // May retry with fresh ephemeral keys
        if (error.recoverable) {
          this.retryHandshake();
        } else {
          this.terminateConnection();
        }
        break;
        
      case P2PErrorCode.SIGNALING_FAILED:
        // Retry signaling with backoff
        this.retryWithBackoff();
        break;
        
      case P2PErrorCode.CONNECTION_FAILED:
        // May try alternative ICE servers
        this.tryAlternativeServers();
        break;
        
      case P2PErrorCode.DECRYPTION_FAILED:
      case P2PErrorCode.MESSAGE_CORRUPTED:
        // Log and request retransmission
        this.requestRetransmission();
        break;
        
      default:
        this.terminateConnection();
    }
  }
  
  // Security-critical: Any authentication failure terminates immediately
  private terminateConnection(): void {
    // Zero out cipher states
    this.zeroizeKeys();
    // Close data channel
    this.dataChannel.close();
    // Close peer connection
    this.pc.close();
  }
  
  private zeroizeKeys(): void {
    // Securely wipe key material from memory
    secureZero(this.noiseState);
  }
}
```

---

## Threat Model

### Assets Protected

1. **Vault Data**: Encrypted password entries, metadata, and sync state
2. **Session Content**: All data exchanged during a sync session
3. **Device Identity**: Static public keys used for authentication
4. **Pairing Relationship**: The binding between two specific devices

### What the Design Protects Against

| Threat | Protection | Mechanism |
|--------|------------|-----------|
| **Passive Network Observer** | ✅ Protected | End-to-end encryption via Noise; DTLS provides additional layer |
| **Compromised Signaling Server** | ✅ Protected | Server only sees opaque encrypted blobs; cannot decrypt or modify data channel content |
| **Man-in-the-Middle (MITM)** | ✅ Protected | Static key verification during Noise XX handshake; keys exchanged out-of-band during pairing |
| **Session Key Compromise** | ✅ Protected | Ephemeral keys per session provide forward secrecy |
| **Long-term Key Compromise (future)** | ✅ Protected | XX pattern ensures compromise of static keys doesn't decrypt past sessions |
| **Replay Attacks** | ✅ Protected | Timestamps + implicit nonces in Noise handshake; nonces in transport encryption |
| **Message Tampering** | ✅ Protected | AEAD encryption (ChaCha20-Poly1305) provides integrity |
| **Traffic Analysis** | ⚠️ Partial | Message padding can help; timing analysis possible but content protected |

### What the Design Does NOT Protect Against

| Threat | Risk Level | Explanation |
|--------|------------|-------------|
| **Compromised Endpoint Device** | 🔴 High | If either device is compromised, the attacker can access decrypted vault data |
| **Shoulder Surfing During Pairing** | 🔴 High | If an attacker observes the QR code/manual code during pairing, they could impersonate a device |
| **Social Engineering** | 🔴 High | Users may be tricked into pairing with attacker's device |
| **Side-Channel Attacks** | 🟡 Medium | Timing, power analysis, or cache attacks against cryptographic operations |
| **Denial of Service** | 🟡 Medium | Attacker can disrupt signaling or network connectivity to prevent sync |
| **Device Theft After Pairing** | 🟡 Medium | Physical access to a paired device allows sync with paired device |
| **Metadata Leakage (signaling)** | 🟢 Low | Signaling server sees when devices sync and their network addresses |
| **Correlation Attacks** | 🟢 Low | Network-level correlation of sync patterns between devices |

### Trust Assumptions

1. **Device Security**: We assume devices running the password manager are not compromised
2. **Secure Storage**: We assume the device's secure storage (keychain, keystore) properly protects static keys
3. **Pairing Integrity**: We assume the pairing exchange happened securely without interception
4. **Cryptographic Primitives**: We assume the security of:
   - X25519/Ed25519 elliptic curve cryptography
   - ChaCha20-Poly1305 AEAD
   - BLAKE2s hash function
   - Noise Protocol framework
5. **WebRTC Security**: We assume WebRTC's DTLS implementation is secure for transport
6. **Randomness**: We assume the platform's CSPRNG is secure

### Attack Scenarios and Mitigations

#### Scenario 1: Signaling Server Compromise

**Attack**: An attacker gains control of the pairing/signaling server.

**Impact**: 
- Attacker can see encrypted signaling messages (opaque blobs)
- Attacker can drop or delay messages (DoS)
- Attacker **cannot** decrypt data channel content
- Attacker **cannot** impersonate a paired device (lacks static keys)

**Mitigation**: 
- Noise handshake detects any tampering with signaling
- Pairing tokens verified during handshake prevent unauthorized connections

#### Scenario 2: Active MITM During Sync

**Attack**: An attacker intercepts the WebRTC connection attempt.

**Impact**:
- Without static keys, attacker cannot complete Noise XX handshake
- Handshake will fail with authentication error

**Mitigation**:
- Static key verification in messages 2 and 3 of Noise XX
- Failed verification terminates connection immediately

#### Scenario 3: Replay of Old Session

**Attack**: An attacker records and replays messages from a previous sync session.

**Impact**:
- Noise handshake includes ephemeral keys that are unique per session
- Old handshake messages are cryptographically bound to their session

**Mitigation**:
- Fresh ephemeral keys per session
- Timestamps in authentication payloads
- Implicit nonces in Noise protocol

#### Scenario 4: Post-Compromise Security

**Attack**: An attacker compromises a device's static key after a sync session.

**Impact**:
- Attacker cannot decrypt past session contents
- Attacker can impersonate the device in future sessions

**Mitigation**:
- XX pattern provides forward secrecy
- Consider periodic re-pairing to rotate static keys

---

## Security Checklist

### Implementation Verification

- [ ] Noise XX pattern correctly implemented using established library
- [ ] Static Ed25519 keys converted to X25519 for Noise operations
- [ ] Public keys verified during handshake match pairing exchange
- [ ] Pairing token verified in both handshake directions
- [ ] Session keys never written to persistent storage
- [ ] Session keys securely zeroed from memory after use
- [ ] All vault data encrypted with Noise CipherState before transmission
- [ ] Message authentication verified before processing
- [ ] Replay protection implemented (timestamps/nonces)
- [ ] Failed authentication terminates connection immediately
- [ ] No sensitive data in signaling messages
- [ ] Error messages don't leak sensitive information

### Testing Requirements

- [ ] Unit tests for Noise handshake (all message sequences)
- [ ] Unit tests for key conversion (Ed25519 ↔ X25519)
- [ ] Unit tests for encryption/decryption with CipherState
- [ ] Integration tests for full sync flow
- [ ] Negative tests for authentication failures
- [ ] Negative tests for tampered messages
- [ ] Replay attack simulation tests
- [ ] MITM attack simulation tests
- [ ] Fuzzing of message parsing code
- [ ] Memory inspection for key leakage

---

## References

1. **Noise Protocol Framework**: https://noiseprotocol.org/noise.html
   - Section 7.5: XX pattern
   - Section 12: Application responsibilities

2. **Noise Explorer**: https://noiseexplorer.com/
   - Formal verification of Noise patterns

3. **WebRTC Security**: https://webrtc-security.github.io/
   - DTLS and data channel security

4. **Ed25519 to X25519 Conversion**: RFC 7748, Section 5
   - Montgomery/Edwards curve correspondence

5. **BLAKE2**: https://www.blake2.net/
   - Hash function used in Noise

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-11 | Lotus Team | Initial design document |

---

## Appendix: Noise XX Pattern Details

### Full Pattern Specification

```
Noise_XX_25519_ChaChaPoly_BLAKE2s:
  Pattern: XX
  Curve: X25519
  Cipher: ChaChaPoly (ChaCha20-Poly1305)
  Hash: BLAKE2s (256-bit)
```

### Cryptographic Primitives

| Primitive | Specification | Purpose |
|-----------|---------------|---------|
| ECDH | X25519 | Key agreement |
| AEAD | ChaCha20-Poly1305 | Symmetric encryption |
| Hash | BLAKE2s-256 | Key derivation, mixing |
| Signatures | Ed25519 | Device identity (converted to X25519 for Noise) |

### Key Hierarchy

```
Device Identity (Ed25519)
    │
    ▼
Convert to X25519
    │
    ▼
Noise Static Key (X25519) ◄────── Exchanged during pairing
    │
    ├──► Noise XX Handshake
    │       ├──► Ephemeral Keys (per-session)
    │       ├──► MixHash Operations
    │       └──► Split()
    │               ├──► Send CipherState (k_send)
    │               └──► Receive CipherState (k_recv)
    │
    └──► Data Encryption (ChaCha20-Poly1305)
```
