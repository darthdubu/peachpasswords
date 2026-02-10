import { VaultEntry } from '@lotus/shared'
import Papa from 'papaparse'

export interface ImportResult {
  entries: VaultEntry[]
  errors: string[]
}

export function parseCSV(content: string): ImportResult {
  const result = Papa.parse(content, { header: true, skipEmptyLines: true })
  const entries: VaultEntry[] = []
  const errors: string[] = []

  if (result.errors.length > 0) {
    return { entries: [], errors: result.errors.map(e => e.message) }
  }

  for (const row of result.data as any[]) {
    try {
      // Detect format based on headers
      if ('login_username' in row || 'login_password' in row) {
        // Bitwarden
        entries.push(mapBitwardenRow(row))
      } else {
        // Generic / Proton (try to match common fields)
        entries.push(mapGenericRow(row))
      }
    } catch (e) {
      console.error(e)
      errors.push(`Failed to parse row: ${JSON.stringify(row)}`)
    }
  }

  return { entries, errors }
}

function mapBitwardenRow(row: any): VaultEntry {
  return {
    id: crypto.randomUUID(),
    type: 'login',
    name: row.name || 'Untitled',
    created: Date.now(),
    modified: Date.now(),
    tags: row.folder ? [row.folder] : [],
    favorite: row.favorite === '1' || row.favorite === 'true',
    login: {
      username: row.login_username || '',
      password: row.login_password || '', // Plain text, must be encrypted by caller
      urls: row.login_uri ? [row.login_uri] : [],
      totp: row.login_totp ? { 
        secret: row.login_totp,
        algorithm: 'SHA1',
        digits: 6,
        period: 30
      } : undefined
    },
    note: row.notes ? { content: row.notes } : undefined
  }
}

function mapGenericRow(row: any): VaultEntry {
  // Handles Proton Pass and generic CSVs
  // Proton: Name, Note, URL, Username, Password, TOTP
  const name = row.name || row.Name || row.title || row.Title || 'Untitled'
  const username = row.username || row.Username || row.login_username || ''
  const password = row.password || row.Password || row.login_password || ''
  const url = row.url || row.URL || row.login_uri || ''
  const totp = row.totp || row.TOTP || row.login_totp || ''
  const note = row.note || row.Note || row.notes || row.Notes || ''

  return {
    id: crypto.randomUUID(),
    type: 'login',
    name,
    created: Date.now(),
    modified: Date.now(),
    tags: [],
    favorite: false,
    login: {
      username,
      password, // Plain text, must be encrypted by caller
      urls: url ? [url] : [],
      totp: totp ? { 
        secret: totp,
        algorithm: 'SHA1',
        digits: 6,
        period: 30
      } : undefined
    },
    note: note ? { content: note } : undefined
  }
}