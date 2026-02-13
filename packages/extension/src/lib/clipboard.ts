export interface ClipboardEntry {
  value: string
  timestamp: number
  timeoutId?: number
}

let currentClipboardEntry: ClipboardEntry | null = null

export function copyToClipboard(value: string, autoClearMs: number = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clear any existing timeout
    if (currentClipboardEntry?.timeoutId) {
      window.clearTimeout(currentClipboardEntry.timeoutId)
    }

    // Write to clipboard
    navigator.clipboard.writeText(value).then(() => {
      // Set up auto-clear
      const timeoutId = window.setTimeout(() => {
        clearClipboard()
      }, autoClearMs)

      currentClipboardEntry = {
        value,
        timestamp: Date.now(),
        timeoutId
      }

      resolve()
    }).catch(reject)
  })
}

export function clearClipboard(): void {
  // Write empty string to clipboard
  navigator.clipboard.writeText('').catch(() => {
    // Ignore errors
  })

  // Clear from memory
  if (currentClipboardEntry) {
    if (currentClipboardEntry.timeoutId) {
      window.clearTimeout(currentClipboardEntry.timeoutId)
    }
    // Overwrite the value before clearing reference
    currentClipboardEntry.value = ''
    currentClipboardEntry = null
  }
}

export function getClipboardTimeRemaining(): number {
  if (!currentClipboardEntry) return 0
  
  const elapsed = Date.now() - currentClipboardEntry.timestamp
  const remaining = 60000 - elapsed
  return Math.max(0, remaining)
}

export function isClipboardActive(): boolean {
  return currentClipboardEntry !== null && getClipboardTimeRemaining() > 0
}

export function formatTimeRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  return `${seconds}s`
}
