import type { Vault, VaultEntry } from './types'

export interface Conflict {
  entryId: string
  localEntry: VaultEntry | null
  remoteEntry: VaultEntry | null
  baseEntry: VaultEntry | null
}

export interface MergeResult {
  vault: Vault
  conflicts: Conflict[]
}

export function threeWayMerge(
  local: Vault,
  remote: Vault,
  base: Vault
): MergeResult {
  const conflicts: Conflict[] = []
  const mergedEntries: VaultEntry[] = []
  const allEntryIds = new Set([
    ...local.entries.map((e: VaultEntry) => e.id),
    ...remote.entries.map((e: VaultEntry) => e.id),
    ...base.entries.map((e: VaultEntry) => e.id),
  ])

  for (const entryId of allEntryIds) {
    const localEntry = local.entries.find((e: VaultEntry) => e.id === entryId) || null
    const remoteEntry = remote.entries.find((e: VaultEntry) => e.id === entryId) || null
    const baseEntry = base.entries.find((e: VaultEntry) => e.id === entryId) || null

    if (!localEntry && !remoteEntry) {
      continue
    }

    if (!localEntry) {
      if (baseEntry) {
        conflicts.push({ entryId, localEntry, remoteEntry, baseEntry })
      } else {
        mergedEntries.push(remoteEntry!)
      }
      continue
    }

    if (!remoteEntry) {
      if (baseEntry) {
        conflicts.push({ entryId, localEntry, remoteEntry, baseEntry })
      }
      continue
    }

    if (baseEntry && localEntry && entriesEqual(localEntry, baseEntry)) {
      mergedEntries.push(remoteEntry!)
    } else if (baseEntry && remoteEntry && entriesEqual(remoteEntry, baseEntry)) {
      mergedEntries.push(localEntry!)
    } else if (localEntry && remoteEntry && entriesEqual(localEntry, remoteEntry)) {
      mergedEntries.push(localEntry!)
    } else {
      conflicts.push({ entryId, localEntry, remoteEntry, baseEntry })
      if (localEntry) mergedEntries.push(localEntry)
    }
  }

  return {
    vault: {
      ...local,
      entries: mergedEntries,
      syncVersion: Math.max(local.syncVersion, remote.syncVersion) + 1,
      lastSync: Date.now(),
    },
    conflicts,
  }
}

function entriesEqual(a: VaultEntry, b: VaultEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function resolveConflict(
  conflict: Conflict,
  winner: 'local' | 'remote'
): VaultEntry | null {
  return winner === 'local' ? conflict.localEntry : conflict.remoteEntry
}
