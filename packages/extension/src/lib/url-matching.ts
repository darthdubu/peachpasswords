import { VaultEntry } from '@lotus/shared'
import { getUrlMatchScore, getEntryNameMatchScore } from './url-match'

const DEBUG = false

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[Peach URL Matching]', ...args)
  }
}

export function getMatchingEntries(entries: VaultEntry[], pageUrl: string): VaultEntry[] {
  log('Getting matching entries for URL:', pageUrl)
  
  try {
    return entries.filter(entry => {
      if (entry.type !== 'login' || !entry.login?.urls?.length) {
        return false
      }
      
      const hasUrlMatch = entry.login.urls.some(storedUrl => {
        try {
          const score = getUrlMatchScore(storedUrl, pageUrl)
          return score >= 74
        } catch {
          try {
            const score = getUrlMatchScore(`https://${storedUrl}`, pageUrl)
            return score >= 74
          } catch { 
            return false 
          }
        }
      })
      
      if (hasUrlMatch) {
        return true
      }
      
      if (entry.name) {
        const nameScore = getEntryNameMatchScore(entry.name, pageUrl)
        if (nameScore >= 70) {
          return true
        }
      }
      
      return false
    })
  } catch (error) {
    log('Error getting matching entries:', error)
    return []
  }
}

export function isSecureContextForAutofill(url: string): boolean {
  try {
    const parsed = new URL(url)
    
    if (parsed.protocol === 'https:') {
      return true
    }
    
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return true
    }
    
    return false
  } catch {
    return false
  }
}

export function getSafeOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function matchesOrigin(storedUrl: string, pageUrl: string): boolean {
  try {
    const storedOrigin = new URL(storedUrl).origin
    const pageOrigin = new URL(pageUrl).origin
    return storedOrigin === pageOrigin
  } catch {
    try {
      const storedOrigin = new URL(`https://${storedUrl}`).origin
      const pageOrigin = new URL(pageUrl).origin
      return storedOrigin === pageOrigin
    } catch {
      return false
    }
  }
}

export function sortEntriesByRelevance(
  entries: VaultEntry[], 
  pageUrl: string,
  lastUsedMap: Record<string, number> = {}
): VaultEntry[] {
  return [...entries].sort((a, b) => {
    const getBestScore = (entry: VaultEntry): number => {
      let bestScore = 0
      
      if (entry.login?.urls) {
        for (const url of entry.login.urls) {
          const score = getUrlMatchScore(url, pageUrl)
          if (score > bestScore) bestScore = score
        }
      }
      
      if (entry.name) {
        const nameScore = getEntryNameMatchScore(entry.name, pageUrl)
        if (nameScore > bestScore) bestScore = nameScore
      }
      
      return bestScore
    }
    
    const scoreA = getBestScore(a)
    const scoreB = getBestScore(b)
    
    if (scoreB !== scoreA) {
      return scoreB - scoreA
    }
    
    const lastUsedA = lastUsedMap[a.id] || 0
    const lastUsedB = lastUsedMap[b.id] || 0
    return lastUsedB - lastUsedA
  })
}
