import type { Vault, VaultEntry } from '@lotus/shared'

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

function entriesEqual(a: VaultEntry, b: VaultEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function threeWayMerge(
  local: Vault,
  remote: Vault,
  base: Vault,
  constantTimeDelayMs = 500
): Promise<MergeResult> {
  const startTime = performance.now()

  const conflicts: Conflict[] = []
  const mergedEntries: VaultEntry[] = []
  const allEntryIds = new Set([
    ...local.entries.map((e) => e.id),
    ...remote.entries.map((e) => e.id),
    ...base.entries.map((e) => e.id)
  ])

  for (const entryId of allEntryIds) {
    const localEntry = local.entries.find((e) => e.id === entryId) || null
    const remoteEntry = remote.entries.find((e) => e.id === entryId) || null
    const baseEntry = base.entries.find((e) => e.id === entryId) || null

    if (!localEntry && !remoteEntry) continue
    if (!localEntry) {
      if (baseEntry) {
        conflicts.push({ entryId, localEntry, remoteEntry, baseEntry })
        // Preserve remote when local deleted but remote still present.
        if (remoteEntry) mergedEntries.push(remoteEntry)
      } else if (remoteEntry) {
        mergedEntries.push(remoteEntry)
      }
      continue
    }
    if (!remoteEntry) {
      if (baseEntry) {
        conflicts.push({ entryId, localEntry, remoteEntry, baseEntry })
        // Preserve local when remote deleted but local still present.
        mergedEntries.push(localEntry)
      } else {
        mergedEntries.push(localEntry)
      }
      continue
    }
    if (baseEntry && entriesEqual(localEntry, baseEntry)) mergedEntries.push(remoteEntry)
    else if (baseEntry && entriesEqual(remoteEntry, baseEntry)) mergedEntries.push(localEntry)
    else if (entriesEqual(localEntry, remoteEntry)) mergedEntries.push(localEntry)
    else {
      conflicts.push({ entryId, localEntry, remoteEntry, baseEntry })
      mergedEntries.push(localEntry)
    }
  }

  const result: MergeResult = {
    vault: {
      ...local,
      entries: mergedEntries,
      syncVersion: Math.max(local.syncVersion, remote.syncVersion) + 1,
      lastSync: Date.now()
    },
    conflicts
  }

  const elapsed = performance.now() - startTime
  const remaining = Math.max(0, constantTimeDelayMs - elapsed)

  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining))
  }

  return result
}
