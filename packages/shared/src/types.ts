export interface IdentityMetadata {
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
}

// LOTUS-017: Encrypted metadata for entry privacy
export interface EncryptedEntryMetadata {
  name: string;
  favorite: boolean;
  tags: string[];
  created: number;
  urls?: string[];
  username?: string;
  cardHolder?: string;
  expMonth?: string;
  expYear?: string;
  cardBrand?: string;
  identity?: IdentityMetadata;
  totpIssuer?: string;
  passkeyInfo?: { 
    rpId: string; 
    rpName: string; 
    userName: string 
  };
}

// LOTUS-017: VaultEntry with encrypted metadata
// Sensitive metadata fields are encrypted to prevent information leakage
export interface VaultEntry {
  id: string;                          // UUIDv4 - kept plaintext for indexing
  type: "login" | "card" | "identity" | "note";  // kept plaintext for filtering
  modified: number;                    // Unix timestamp (ms) - kept plaintext for sorting
  trashedAt?: number;                  // Unix timestamp (ms) - kept plaintext for trash management
  trashExpiresAt?: number;             // Unix timestamp (ms) - kept plaintext for trash management
  
  // LOTUS-017: Encrypted metadata blob containing sensitive fields
  encryptedMetadata: string;
  
  // Legacy fields - kept for backward compatibility during migration
  // These should not be used for new entries
  name?: string;                       // Deprecated: now in encryptedMetadata
  favorite?: boolean;                  // Deprecated: now in encryptedMetadata
  created?: number;                    // Deprecated: now in encryptedMetadata
  tags?: string[];                     // Deprecated: now in encryptedMetadata
  login?: {
    urls?: string[];                   // Deprecated: now in encryptedMetadata
    username?: string;                 // Deprecated: now in encryptedMetadata
    password: string;                  // Encrypted per-entry
    totp?: {
      secret: string;                  // Base32 TOTP secret (encrypted)
      algorithm: "SHA1" | "SHA256" | "SHA512";
      digits: 6 | 8;
      period: number;                  // Usually 30
      issuer?: string;                 // Deprecated: now in encryptedMetadata
    };
    passkey?: {
      credentialId: string;            // Base64url
      rpId?: string;                   // Deprecated: now in encryptedMetadata
      rpName?: string;                 // Deprecated: now in encryptedMetadata
      userHandle: string;              // Base64url
      userName?: string;               // Deprecated: now in encryptedMetadata
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
  card?: {
    holder?: string;                   // Deprecated: now in encryptedMetadata
    number: string;                    // Encrypted
    expMonth?: string;                 // Deprecated: now in encryptedMetadata
    expYear?: string;                  // Deprecated: now in encryptedMetadata
    cvv: string;                       // Encrypted
    brand?: string;                    // Deprecated: now in encryptedMetadata
  };
  identity?: IdentityMetadata;         // Deprecated: now in encryptedMetadata
  note?: {
    content: string;                   // Encrypted per-entry
  };
}

export interface Vault {
  version: number;                     // Schema version for migrations
  entries: VaultEntry[];
  folders: { id: string; name: string; }[];
  lastSync: number;                    // Timestamp of last successful sync
  syncVersion: number;                 // Monotonically increasing, for conflict detection
  contentHash?: string;                // LOTUS-005: SHA-256 hash of all entry IDs + version for integrity
}

export type SyncOperationKind = 'entry-upsert' | 'entry-delete' | 'vault-write'
export type SyncSource = 'local' | 'server' | 's3' | 'background'

export interface SyncOperation {
  id: string
  seq: number
  kind: SyncOperationKind
  entityId?: string
  payloadHash?: string
  queuedAt: number
}

export type SyncEventType =
  | 'sync-start'
  | 'sync-push'
  | 'sync-pull'
  | 'sync-merge'
  | 'sync-conflict'
  | 'sync-success'
  | 'sync-error'
  | 'sync-queued'
  | 'migration'

export interface SyncEvent {
  id: string
  timestamp: number
  type: SyncEventType
  status: 'info' | 'warning' | 'error'
  detail: string
}

export interface SecurityScore {
  score: number
  maxScore: number
  weakPasswords: number
  reusedPasswords: number
  missingTotp: number
}
