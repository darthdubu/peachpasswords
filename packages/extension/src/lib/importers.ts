import { VaultEntry } from '@lotus/shared'
import Papa from 'papaparse'
import JSZip from 'jszip'
import { normalizeStoredUrl } from './url-match'

export interface ImportResult {
  entries: VaultEntry[]
  errors: string[]
}

export interface ZipImportResult extends ImportResult {
  totalFiles: number
  supportedFiles: number
}

const BW_CSV_LOGIN_URI_FIELD = 'login_uri'
const BW_JSON_LOGIN_URIS_FIELD = 'uris'

type GenericObject = Record<string, unknown>

export function parseCSV(content: string): ImportResult {
  const result = Papa.parse(content, { header: true, skipEmptyLines: true })
  const entries: VaultEntry[] = []
  const errors: string[] = []

  if (result.errors.length > 0) {
    return { entries: [], errors: result.errors.map(e => e.message) }
  }

  for (const row of result.data as GenericObject[]) {
    try {
      // Detect format based on headers
      if ('login_username' in row || 'login_password' in row || BW_CSV_LOGIN_URI_FIELD in row) {
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

export function parseImportFile(content: string, fileName?: string): ImportResult {
  const trimmed = content.trim()
  const lowerName = (fileName || '').toLowerCase()
  const looksLikeJson = lowerName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')

  if (looksLikeJson) {
    const jsonResult = parseJSON(content)
    // If JSON parse fails hard, fallback to CSV in case extension/type is wrong.
    if (jsonResult.entries.length > 0 || jsonResult.errors.length === 0) return jsonResult
  }

  return parseCSV(content)
}

export async function parseZipImport(zipData: ArrayBuffer, fileName = 'archive.zip'): Promise<ZipImportResult> {
  const entries: VaultEntry[] = []
  const errors: string[] = []

  try {
    const zip = await JSZip.loadAsync(zipData)
    const files = Object.values(zip.files).filter((file) => !file.dir)
    const supported = files.filter((file) => {
      const name = file.name.toLowerCase()
      return name.endsWith('.json') || name.endsWith('.csv')
    })

    if (supported.length === 0) {
      return {
        entries: [],
        errors: [`No supported CSV/JSON files found in ${fileName}.`],
        totalFiles: files.length,
        supportedFiles: 0
      }
    }

    for (const file of supported) {
      try {
        const content = await file.async('string')
        const parsed = parseImportFile(content, file.name)
        entries.push(...parsed.entries)
        for (const error of parsed.errors) {
          errors.push(`[${file.name}] ${error}`)
        }
      } catch (error) {
        errors.push(`[${file.name}] Failed to extract file: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return {
      entries,
      errors,
      totalFiles: files.length,
      supportedFiles: supported.length
    }
  } catch (error) {
    return {
      entries: [],
      errors: [`Failed to read ZIP archive ${fileName}: ${error instanceof Error ? error.message : String(error)}`],
      totalFiles: 0,
      supportedFiles: 0
    }
  }
}

export function parseJSON(content: string): ImportResult {
  const entries: VaultEntry[] = []
  const errors: string[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    return {
      entries: [],
      errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`]
    }
  }

  const candidates = collectJsonCandidates(parsed)
  if (candidates.length === 0) {
    return {
      entries: [],
      errors: ['No importable items found in JSON file.']
    }
  }

  for (const candidate of candidates) {
    try {
      const mapped = mapJsonEntry(candidate)
      if (mapped) entries.push(mapped)
    } catch (error) {
      errors.push(`Failed to parse JSON entry: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { entries, errors }
}

function mapBitwardenRow(row: GenericObject): VaultEntry {
  const loginUri = getString(row, [BW_CSV_LOGIN_URI_FIELD, 'login_uri_1', 'uri', 'url'])
  const folder = getString(row, ['folder'])
  const totp = getString(row, ['login_totp', 'totp'])
  const notes = getString(row, ['notes', 'note'])
  return {
    id: crypto.randomUUID(),
    type: 'login',
    name: getString(row, ['name', 'title', 'Name']) || 'Untitled',
    created: Date.now(),
    modified: Date.now(),
    tags: folder ? [folder] : [],
    favorite: parseBooleanLike(getString(row, ['favorite'])),
    encryptedMetadata: '', // Will be encrypted by caller
    login: {
      username: getString(row, ['login_username', 'username']) || '',
      password: getString(row, ['login_password', 'password']) || '', // Plain text, must be encrypted by caller
      urls: normalizeUrls([loginUri]),
      totp: totp ? {
        secret: totp,
        algorithm: 'SHA1',
        digits: 6,
        period: 30
      } : undefined
    },
    note: notes ? { content: notes } : undefined
  }
}

function mapGenericRow(row: GenericObject): VaultEntry {
  // Handles Proton Pass and generic CSVs
  // Proton: Name, Note, URL, Username, Password, TOTP
  const name = getString(row, ['name', 'Name', 'title', 'Title']) || 'Untitled'
  const username = getString(row, ['username', 'Username', 'login_username']) || ''
  const password = getString(row, ['password', 'Password', 'login_password']) || ''
  const urls = normalizeUrls([
    getString(row, ['url', 'URL', 'login_uri']),
    getString(row, ['website', 'Website', 'website_url'])
  ])
  const totp = getString(row, ['totp', 'TOTP', 'login_totp']) || ''
  const note = getString(row, ['note', 'Note', 'notes', 'Notes']) || ''

  return {
    id: crypto.randomUUID(),
    type: 'login',
    name,
    created: Date.now(),
    modified: Date.now(),
    tags: [],
    favorite: false,
    encryptedMetadata: '', // Will be encrypted by caller
    login: {
      username,
      password, // Plain text, must be encrypted by caller
      urls,
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

function collectJsonCandidates(parsed: unknown): GenericObject[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isObject)
  }
  if (!isObject(parsed)) return []

  const root = parsed as GenericObject

  // Bitwarden JSON export
  const bwItems = root['items']
  if (Array.isArray(bwItems)) {
    return bwItems.filter(isObject)
  }

  // Proton Pass shapes: vaults -> items, or direct logins/items arrays.
  const vaults = root['vaults']
  if (Array.isArray(vaults)) {
    const fromVaults: GenericObject[] = []
    for (const vault of vaults) {
      if (!isObject(vault)) continue
      const items = vault['items']
      if (Array.isArray(items)) {
        fromVaults.push(...items.filter(isObject))
      }
    }
    if (fromVaults.length > 0) return fromVaults
  }

  for (const key of ['entries', 'logins', 'data']) {
    const value = root[key]
    if (Array.isArray(value)) {
      return value.filter(isObject)
    }
  }

  return []
}

function mapJsonEntry(item: GenericObject): VaultEntry | null {
  const typeHint = (getString(item, ['type']) || '').toLowerCase()
  const loginObj = getObject(item, ['login', 'content', 'itemContent'])

  const username = getString(loginObj || item, [
    'username',
    'login_username',
    'userName',
    'email'
  ]) || ''
  const password = getString(loginObj || item, [
    'password',
    'login_password'
  ]) || ''

  const urls = extractUrlsFromJson(item, loginObj)
  const hasLoginLikeData = !!password || !!username || urls.length > 0 || !!loginObj

  if (!hasLoginLikeData && typeHint && typeHint !== 'login') {
    // Skip non-login items for now to match current import behavior.
    return null
  }

  const name = getString(item, ['name', 'title']) ||
    getString(getObject(item, ['metadata']), ['name', 'title']) ||
    'Untitled'
  const note = getString(item, ['notes', 'note']) ||
    getString(getObject(item, ['metadata']), ['note']) ||
    ''
  const totp = getString(loginObj || item, ['totp', 'otp', 'totpSecret']) || ''

  const tags = getStringArray(item, ['tags', 'tag']) ||
    getStringArray(getObject(item, ['metadata']), ['tags']) ||
    []

  return {
    id: crypto.randomUUID(),
    type: 'login',
    name,
    created: Date.now(),
    modified: Date.now(),
    tags,
    favorite: parseBooleanLike(getString(item, ['favorite'])),
    encryptedMetadata: '', // Will be encrypted by caller
    login: {
      username,
      password,
      urls,
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

function extractUrlsFromJson(item: GenericObject, loginObj?: GenericObject | null): string[] {
  const urls: string[] = []
  const source = loginObj || item

  const flatCandidates = [
    getString(source, ['uri', 'url', 'website', 'origin']),
    getString(item, ['uri', 'url', 'website'])
  ]
  urls.push(...flatCandidates.filter((value): value is string => !!value))

  const bwUris = (source as GenericObject)[BW_JSON_LOGIN_URIS_FIELD] ?? (item as GenericObject)[BW_JSON_LOGIN_URIS_FIELD]
  if (Array.isArray(bwUris)) {
    for (const uriCandidate of bwUris) {
      if (typeof uriCandidate === 'string') {
        urls.push(uriCandidate)
      } else if (isObject(uriCandidate)) {
        const uriValue = getString(uriCandidate, ['uri', 'url'])
        if (uriValue) urls.push(uriValue)
      }
    }
  }

  const domainCandidates = [
    getString(source, ['domain']),
    getString(source, ['hostname']),
    getString(item, ['domain']),
    getString(getObject(item, ['metadata']), ['domain', 'hostname'])
  ]
  urls.push(...domainCandidates.filter((value): value is string => !!value))

  return normalizeUrls(urls)
}

function normalizeUrls(values: Array<string | undefined | null>): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const candidate of values) {
    if (!candidate || typeof candidate !== 'string') continue
    const value = candidate.trim()
    if (!value) continue
    const normalizedUrl = normalizeStoredUrl(value) || normalizeStoredUrl(`https://${value}`) || value
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl)
      normalized.push(normalizedUrl)
    }
  }
  return normalized
}

function isObject(value: unknown): value is GenericObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getObject(value: unknown, keys: string[]): GenericObject | null {
  if (!isObject(value)) return null
  for (const key of keys) {
    const candidate = value[key]
    if (isObject(candidate)) return candidate
  }
  return null
}

function getString(value: unknown, keys: string[]): string | undefined {
  if (!isObject(value)) return undefined
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return undefined
}

function getStringArray(value: unknown, keys: string[]): string[] | undefined {
  if (!isObject(value)) return undefined
  for (const key of keys) {
    const candidate = value[key]
    if (!Array.isArray(candidate)) continue
    const asStrings = candidate
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    if (asStrings.length > 0) return asStrings
  }
  return undefined
}

function parseBooleanLike(value?: string): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}