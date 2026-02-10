export interface VaultEntry {
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

export interface Vault {
  version: number;                     // Schema version for migrations
  entries: VaultEntry[];
  folders: { id: string; name: string; }[];
  lastSync: number;                    // Timestamp of last successful sync
  syncVersion: number;                 // Monotonically increasing, for conflict detection
}
