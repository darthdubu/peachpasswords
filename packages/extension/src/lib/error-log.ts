import { STORAGE_KEYS } from './constants'

export type ExtensionErrorSource = 'popup' | 'content' | 'background' | 'sync' | 'import' | 'autofill'

export interface ExtensionErrorRecord {
  id: string
  timestamp: number
  source: ExtensionErrorSource
  category: string
  message: string
  details?: string
}

const MAX_ERROR_LOGS = 300

export async function readExtensionErrors(): Promise<ExtensionErrorRecord[]> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.ERROR_LOGS])
  const raw = result[STORAGE_KEYS.ERROR_LOGS]
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is ExtensionErrorRecord => {
      return !!item && typeof item === 'object' && typeof (item as ExtensionErrorRecord).message === 'string'
    })
    .sort((a, b) => b.timestamp - a.timestamp)
}

export async function clearExtensionErrors(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.ERROR_LOGS]: [] })
}

export async function appendExtensionError(input: Omit<ExtensionErrorRecord, 'id' | 'timestamp'>): Promise<void> {
  try {
    const current = await readExtensionErrors()
    const record: ExtensionErrorRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      source: input.source,
      category: input.category,
      message: input.message,
      details: input.details
    }

    const last = current[0]
    // Collapse noisy duplicates occurring back-to-back.
    if (
      last &&
      last.source === record.source &&
      last.category === record.category &&
      last.message === record.message &&
      (record.timestamp - last.timestamp) < 3000
    ) {
      return
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.ERROR_LOGS]: [record, ...current].slice(0, MAX_ERROR_LOGS)
    })
  } catch {
    // Logging should never crash product flows.
  }
}
