import type { Vault, VaultEntry } from '@lotus/shared'
import { beginMigration, completeMigration, getMigrationSnapshot, setRollingBack } from './migration-state'
import { encryptEntryMetadata, decryptEntryMetadata } from './crypto-utils'

// LOTUS-017: Schema version 3 introduces encrypted entry metadata
export const CURRENT_VAULT_SCHEMA_VERSION = 3

/**
 * Migrate vault to current schema version
 */
async function migrateVaultSchema(vault: Vault): Promise<Vault> {
  let migratedVault = { ...vault }
  
  // Ensure basic structure
  if (!Array.isArray(migratedVault.entries)) {
    migratedVault.entries = []
  }
  if (!Array.isArray(migratedVault.folders)) {
    migratedVault.folders = []
  }
  
  // v2 migration: ensure folder array and typed defaults
  if (migratedVault.version < 2) {
    migratedVault = {
      ...migratedVault,
      version: 2,
      folders: Array.isArray(migratedVault.folders) ? migratedVault.folders : [],
      entries: Array.isArray(migratedVault.entries) ? migratedVault.entries : []
    }
  }
  
  // v3 migration: prepare entries for encrypted metadata
  // Note: Actual encryption happens during save via VaultContext
  if (migratedVault.version < 3) {
    migratedVault = {
      ...migratedVault,
      version: 3,
      entries: migratedVault.entries.map(entry => ({
        ...entry,
        // Ensure encryptedMetadata field exists (will be empty for legacy entries)
        encryptedMetadata: entry.encryptedMetadata || ''
      }))
    }
  }
  
  return migratedVault
}

export async function migrateVaultWithRecovery(
  vault: Vault,
  backup: { vault?: number[]; aad?: string; syncVersion?: number }
): Promise<Vault> {
  if (vault.version >= CURRENT_VAULT_SCHEMA_VERSION) return vault
  
  await beginMigration(CURRENT_VAULT_SCHEMA_VERSION, backup)
  try {
    const migrated = await migrateVaultSchema(vault)
    await completeMigration()
    return migrated
  } catch (error) {
    await setRollingBack()
    throw error
  }
}

export async function recoverIncompleteMigration(): Promise<{
  restored: boolean
  vault?: number[]
  aad?: string
  syncVersion?: number
}> {
  const snapshot = await getMigrationSnapshot()
  if (snapshot.state === 'normal') return { restored: false }

  if (!snapshot.backupVault) {
    await completeMigration()
    return { restored: false }
  }

  await setRollingBack()
  const restored = {
    vault: snapshot.backupVault,
    aad: snapshot.backupAad,
    syncVersion: snapshot.backupSyncVersion
  }
  await completeMigration()
  return { restored: true, ...restored }
}

/**
 * LOTUS-017: Encrypt metadata for all entries in a vault
 * This should be called when vault is unlocked with masterKey available
 * 
 * NOTE: We keep both encrypted metadata AND plaintext fields
 * The encrypted metadata ensures data is encrypted at rest.
 * The plaintext fields remain for UI convenience while vault is unlocked.
 */
export async function encryptMetadataForAllEntries(
  vault: Vault,
  masterKey: CryptoKey
): Promise<Vault> {
  const migratedEntries: VaultEntry[] = []
  
  for (const entry of vault.entries) {
    // Skip entries that already have encrypted metadata
    if (entry.encryptedMetadata && entry.encryptedMetadata.length > 0) {
      migratedEntries.push(entry)
      continue
    }
    
    // Encrypt metadata for this entry
    try {
      const encryptedMetadata = await encryptEntryMetadata(masterKey, entry)
      
      // Keep the full entry with encrypted metadata added
      migratedEntries.push({
        ...entry,
        encryptedMetadata
      })
    } catch (error) {
      console.error(`Failed to encrypt metadata for entry ${entry.id}:`, error)
      // Keep original entry if encryption fails
      migratedEntries.push(entry)
    }
  }
  
  return {
    ...vault,
    version: CURRENT_VAULT_SCHEMA_VERSION,
    entries: migratedEntries
  }
}

/**
 * LOTUS-017: Check if any entries need metadata encryption migration
 */
export function hasEntriesNeedingMetadataMigration(vault: Vault): boolean {
  return vault.entries.some(entry => !entry.encryptedMetadata || entry.encryptedMetadata.length === 0)
}

/**
 * LOTUS-017: Hydrate entries with decrypted metadata
 * 
 * This function restores plaintext fields for entries that were saved
 * with encrypted metadata but missing plaintext fields (due to the bug
 * in the initial LOTUS-017 implementation).
 * 
 * It should be called after vault unlock with the masterKey available.
 */
export async function hydrateEntriesWithMetadata(
  vault: Vault,
  masterKey: CryptoKey
): Promise<Vault> {
  const hydratedEntries: VaultEntry[] = []
  
  for (const entry of vault.entries) {
    // If entry already has plaintext name, it's already hydrated
    if (entry.name && entry.name.length > 0) {
      hydratedEntries.push(entry)
      continue
    }
    
    // If entry has encrypted metadata, try to decrypt it
    if (entry.encryptedMetadata && entry.encryptedMetadata.length > 0) {
      try {
        const metadata = await decryptEntryMetadata(masterKey, entry.id, entry.encryptedMetadata)
        if (metadata) {
          // Restore plaintext fields from decrypted metadata
          hydratedEntries.push({
            ...entry,
            name: metadata.name,
            favorite: metadata.favorite,
            tags: metadata.tags,
            created: metadata.created,
            login: entry.login ? {
              ...entry.login,
              urls: metadata.urls || entry.login.urls,
              username: metadata.username || entry.login.username,
              totp: entry.login.totp ? {
                ...entry.login.totp,
                issuer: metadata.totpIssuer || entry.login.totp.issuer
              } : undefined,
              passkey: entry.login.passkey && metadata.passkeyInfo ? {
                ...entry.login.passkey,
                rpId: metadata.passkeyInfo.rpId || entry.login.passkey.rpId,
                rpName: metadata.passkeyInfo.rpName || entry.login.passkey.rpName,
                userName: metadata.passkeyInfo.userName || entry.login.passkey.userName
              } : entry.login.passkey
            } : undefined,
            card: entry.card ? {
              ...entry.card,
              holder: metadata.cardHolder || entry.card.holder,
              expMonth: metadata.expMonth || entry.card.expMonth,
              expYear: metadata.expYear || entry.card.expYear,
              brand: metadata.cardBrand || entry.card.brand
            } : undefined,
            identity: metadata.identity || entry.identity
          })
          continue
        }
      } catch (error) {
        console.error(`Failed to hydrate entry ${entry.id}:`, error)
      }
    }
    
    // If decryption fails or no metadata, keep entry as-is
    hydratedEntries.push(entry)
  }
  
  return {
    ...vault,
    entries: hydratedEntries
  }
}
