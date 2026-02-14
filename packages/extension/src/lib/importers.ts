import { VaultEntry } from '@lotus/shared'
import Papa from 'papaparse'
import JSZip from 'jszip'
import { normalizeStoredUrl } from './url-match'
import { isPGPEncrypted, decryptPGPMessage } from './pgp'

export interface ImportResult {
  entries: VaultEntry[]
  errors: string[]
}

export interface ZipImportResult extends ImportResult {
  totalFiles: number
  supportedFiles: number
}

const BW_CSV_LOGIN_URI_FIELD = 'login_uri'

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

export function isPGPEncryptedFile(content: string): boolean {
  return isPGPEncrypted(content)
}

export async function decryptAndParseImportFile(
  content: string,
  passphrase: string,
  fileName?: string
): Promise<ImportResult> {
  if (!isPGPEncrypted(content)) {
    return parseImportFile(content, fileName)
  }

  const decryptionResult = await decryptPGPMessage(content, passphrase)

  if (!decryptionResult.success) {
    return {
      entries: [],
      errors: [`PGP decryption failed: ${decryptionResult.error}`]
    }
  }

  return parseImportFile(decryptionResult.decryptedContent || '', fileName)
}

export function parseImportFile(content: string, fileName?: string): ImportResult {
  const trimmed = content.trim()
  const lowerName = (fileName || '').toLowerCase()
  const looksLikeJson = lowerName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')

  if (looksLikeJson) {
    const jsonResult = parseJSON(trimmed)
    if (jsonResult.entries.length > 0 || jsonResult.errors.length === 0) return jsonResult
  }

  return parseCSV(trimmed)
}

export interface PGPZipImportResult extends ZipImportResult {
  pgpFiles: { name: string; content: string }[]
}

export async function parseZipImport(zipData: ArrayBuffer, fileName = 'archive.zip'): Promise<PGPZipImportResult> {
  const entries: VaultEntry[] = []
  const errors: string[] = []
  const pgpFiles: { name: string; content: string }[] = []

  try {
    const zip = await JSZip.loadAsync(zipData)
    const files = Object.values(zip.files).filter((file) => !file.dir)

    for (const file of files) {
      const name = file.name.toLowerCase()

      if (name.startsWith('__macosx/') || name.startsWith('._') || name.includes('/._')) {
        continue
      }

      try {
        let content: string
        const isPGPFile = name.endsWith('.pgp') || name.endsWith('.asc')

        if (isPGPFile) {
          try {
            content = await file.async('string')
          } catch {
            const binary = await file.async('uint8array')
            content = btoa(String.fromCharCode(...binary))
          }
        } else {
          content = await file.async('string')
        }

        if (isPGPEncrypted(content) || isPGPFile) {
          pgpFiles.push({ name: file.name, content })
        } else if (name.endsWith('.json') || name.endsWith('.csv') || content.trim().startsWith('[') || content.trim().startsWith('{')) {
          const parsed = parseImportFile(content, file.name)
          entries.push(...parsed.entries)
          for (const error of parsed.errors) {
            errors.push(`[${file.name}] ${error}`)
          }
        }
      } catch (error) {
        errors.push(`[${file.name}] Failed to extract file: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return {
      entries,
      errors,
      totalFiles: files.length,
      supportedFiles: entries.length > 0 ? entries.length : pgpFiles.length,
      pgpFiles
    }
  } catch (error) {
    return {
      entries: [],
      errors: [`Failed to read ZIP archive ${fileName}: ${error instanceof Error ? error.message : String(error)}`],
      totalFiles: 0,
      supportedFiles: 0,
      pgpFiles: []
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
  const name = getString(row, ['name', 'Name', 'title', 'Title']) || 'Untitled'
  const username = getString(row, ['username', 'Username', 'login_username']) || ''
  const password = getString(row, ['password', 'Password', 'login_password']) || ''
  
  const url = getString(row, ['url', 'URL'])
  const urls = normalizeUrls(url ? [url] : [
    getString(row, ['login_uri']),
    getString(row, ['website', 'Website', 'website_url'])
  ])
  
  const totp = getString(row, ['totp', 'TOTP', 'login_totp', 'totpUri']) || ''
  const note = getString(row, ['note', 'Note', 'notes', 'Notes']) || ''

  return {
    id: crypto.randomUUID(),
    type: 'login',
    name,
    created: Date.now(),
    modified: Date.now(),
    tags: [],
    favorite: false,
    encryptedMetadata: '',
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
  const content = getObject(item, ['content', 'itemContent']) || item
  const metadata = getObject(item, ['metadata']) || {}
  
  const name = getString(item, ['name', 'title']) ||
    getString(metadata, ['name', 'title']) ||
    'Untitled'
  
  const note = getString(item, ['notes', 'note']) ||
    getString(metadata, ['note']) ||
    ''
    
  const favorite = parseBooleanLike(getString(item, ['favorite'])) ||
    parseBooleanLike(getString(metadata, ['favorite']))
    
  const tags = getStringArray(item, ['tags', 'tag']) ||
    getStringArray(metadata, ['tags']) ||
    []

  const baseEntry = {
    id: crypto.randomUUID(),
    name,
    created: Date.now(),
    modified: Date.now(),
    tags,
    favorite,
    encryptedMetadata: '',
    note: note ? { content: note } : undefined
  }

  switch (typeHint) {
    case 'creditCard':
    case 'creditcard':
      return mapCreditCard(item, content, baseEntry)
    
    case 'identity':
      return mapIdentity(item, content, baseEntry)
    
    case 'note':
      return {
        ...baseEntry,
        type: 'note' as const,
        note: { content: note }
      }
    
    case 'login':
    default:
      return mapLogin(item, content, baseEntry)
  }
}

function mapLogin(_item: GenericObject, content: GenericObject, baseEntry: Partial<VaultEntry>): VaultEntry {
  const loginContent = getObject(content, ['login']) || content
  
  const username = getString(loginContent, ['username', 'email', 'userName']) || ''
  const password = getString(loginContent, ['password']) || ''
  const totpUri = getString(loginContent, ['totpUri', 'totp', 'otp']) || ''
  
  const urls: string[] = []
  const itemUrls = getStringArray(loginContent, ['urls']) || getStringArray(content, ['urls'])
  if (itemUrls) {
    urls.push(...itemUrls)
  }
  const singleUrl = getString(loginContent, ['url', 'uri', 'website'])
  if (singleUrl) {
    urls.push(singleUrl)
  }
  
  let totp = undefined
  if (totpUri) {
    const secret = extractTotpSecretFromUri(totpUri)
    if (secret) {
      totp = {
        secret,
        algorithm: 'SHA1',
        digits: 6,
        period: 30
      }
    }
  }

  return {
    ...baseEntry,
    type: 'login',
    login: {
      username,
      password,
      urls: normalizeUrls(urls),
      totp
    }
  } as VaultEntry
}

function mapCreditCard(_item: GenericObject, content: GenericObject, baseEntry: Partial<VaultEntry>): VaultEntry {
  const cardContent = getObject(content, ['creditCard']) || content
  
  const number = getString(cardContent, ['number', 'cardNumber']) || ''
  const cvv = getString(cardContent, ['cvv', 'cvc', 'code']) || ''
  const holder = getString(cardContent, ['cardHolder', 'cardholderName', 'holder']) || ''
  const expMonth = getString(cardContent, ['expirationDate', 'expiry', 'expiration']) || ''
  const pin = getString(cardContent, ['pin']) || ''

  let expMonthValue = ''
  let expYearValue = ''
  
  if (expMonth) {
    const parts = expMonth.split('/')
    if (parts.length === 2) {
      expMonthValue = parts[0].trim()
      expYearValue = parts[1].trim()
    }
  }

  return {
    ...baseEntry,
    type: 'card',
    card: {
      number,
      cvv,
      holder,
      expMonth: expMonthValue,
      expYear: expYearValue,
      pin
    }
  } as VaultEntry
}

function mapIdentity(_item: GenericObject, content: GenericObject, baseEntry: Partial<VaultEntry>): VaultEntry {
  const identityContent = getObject(content, ['identity']) || content
  
  const fullName = getString(identityContent, ['fullName', 'full_name']) || ''
  const email = getString(identityContent, ['email']) || ''
  const phone = getString(identityContent, ['phone', 'phoneNumber', 'telephone']) || ''
  
  const addressContent = getObject(identityContent, ['address'])
  const street = getString(addressContent || identityContent, ['street', 'streetAddress', 'address']) || ''
  const city = getString(addressContent || identityContent, ['city']) || ''
  const state = getString(addressContent || identityContent, ['state', 'province']) || ''
  const zip = getString(addressContent || identityContent, ['zip', 'postalCode', 'postal_code', 'zipCode']) || ''
  const country = getString(addressContent || identityContent, ['country']) || ''
  
  const nameParts = fullName.split(' ')
  const firstName = nameParts[0] || ''
  const lastName = nameParts.slice(1).join(' ') || ''

  return {
    ...baseEntry,
    type: 'identity',
    identity: {
      firstName,
      lastName,
      email,
      phone,
      address: {
        street,
        city,
        state,
        zip,
        country
      }
    }
  } as unknown as VaultEntry
}

function extractTotpSecretFromUri(uri: string): string | null {
  try {
    const url = new URL(uri)
    const secret = url.searchParams.get('secret')
    return secret || null
  } catch {
    return uri.includes('=') ? uri.split('=').pop() || uri : uri
  }
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