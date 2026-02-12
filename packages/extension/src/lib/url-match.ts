const AUTH_PATH_SEGMENTS = new Set([
  'login',
  'signin',
  'sign-in',
  'auth',
  'account',
  'session',
  'oauth',
  'authorize',
  'verification'
])

const COMMON_SECOND_LEVEL_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.jp',
  'ne.jp',
  'or.jp',
  'co.in',
  'net.in',
  'org.in',
  'co.nz',
  'com.sg',
  'com.hk',
  'com.cn',
  'com.tw',
  'com.br',
  'com.mx',
  'com.tr',
  'com.ar'
])

const CANONICAL_HOST_PREFIXES = new Set(['www', 'm', 'mobile', 'amp'])
const AUTH_HOST_PREFIXES = new Set(['accounts', 'account', 'login', 'signin', 'auth', 'id', 'sso', 'secure', 'passport'])
const IDENTITY_STOP_WORDS = new Set([
  'www',
  'm',
  'mobile',
  'app',
  'com',
  'org',
  'net',
  'co',
  'io',
  'dev',
  'site',
  'login',
  'signin',
  'auth',
  'account'
])

export function normalizeStoredUrl(input: string): string {
  const parsed = parseUrlCandidate(input)
  return parsed ? parsed.toString() : ''
}

export function parseUrlCandidate(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(withScheme)
    if (!url.hostname) return null
    return url
  } catch {
    return null
  }
}

export function getRegistrableDomain(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const parts = host.split('.').filter(Boolean)
  if (parts.length < 2) return null

  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
  if (parts.length >= 3 && COMMON_SECOND_LEVEL_PUBLIC_SUFFIXES.has(lastTwo)) {
    return `${parts[parts.length - 3]}.${lastTwo}`
  }
  return lastTwo
}

function splitIdentityTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !IDENTITY_STOP_WORDS.has(token))
}

export function getSiteIdentityTokens(pageUrlOrHost: string): string[] {
  const parsed = parseUrlCandidate(pageUrlOrHost)
  const host = (parsed?.hostname || pageUrlOrHost).toLowerCase().replace(/\.$/, '')
  const domain = getRegistrableDomain(host) || host
  const hostWithoutTld = domain.split('.').slice(0, -1).join(' ')
  const root = domain.split('.')[0] || ''
  const labels = host.split('.').join(' ')
  const tokens = new Set<string>([
    ...splitIdentityTokens(hostWithoutTld),
    ...splitIdentityTokens(root),
    ...splitIdentityTokens(labels)
  ])
  return Array.from(tokens)
}

export function getEntryNameMatchScore(entryName: string, pageUrlOrHost: string): number {
  const normalizedName = entryName.trim().toLowerCase()
  if (!normalizedName) return 0
  const nameTokens = splitIdentityTokens(normalizedName)
  if (nameTokens.length === 0) return 0
  const siteTokens = getSiteIdentityTokens(pageUrlOrHost)
  if (siteTokens.length === 0) return 0

  const tokenMatches = nameTokens.filter((token) =>
    siteTokens.some((siteToken) => siteToken === token || siteToken.includes(token) || token.includes(siteToken))
  ).length
  if (tokenMatches === 0) return 0

  const overlapRatio = tokenMatches / Math.max(nameTokens.length, 1)
  const exactish = siteTokens.some((siteToken) => normalizedName.includes(siteToken) || siteToken.includes(normalizedName))
  const baseScore = Math.round(overlapRatio * 72)
  return Math.min(95, baseScore + (exactish ? 18 : 8))
}

function looksAuthLikePath(pathname: string): boolean {
  return pathname
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .some(segment => AUTH_PATH_SEGMENTS.has(segment))
}

function normalizeComparableHostname(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean)
  if (labels.length > 2 && CANONICAL_HOST_PREFIXES.has(labels[0])) {
    return labels.slice(1).join('.')
  }
  return labels.join('.')
}

function hasAuthLikeSubdomain(hostname: string): boolean {
  const labels = hostname.toLowerCase().split('.').filter(Boolean)
  return labels.length > 2 && AUTH_HOST_PREFIXES.has(labels[0])
}

export function getUrlMatchScore(storedUrl: string, pageUrl: string): number {
  const stored = parseUrlCandidate(storedUrl)
  const page = parseUrlCandidate(pageUrl)
  if (!stored || !page) return 0

  const storedHost = stored.hostname.toLowerCase()
  const pageHost = page.hostname.toLowerCase()
  const storedComparableHost = normalizeComparableHostname(storedHost)
  const pageComparableHost = normalizeComparableHostname(pageHost)
  const storedPath = stored.pathname || '/'
  const pagePath = page.pathname || '/'

  if (storedHost === pageHost) {
    if (storedPath === pagePath) return 100
    if (storedPath === '/' || pagePath === '/' || pagePath.startsWith(storedPath) || storedPath.startsWith(pagePath)) {
      return 96
    }
    return 92
  }

  if (storedComparableHost === pageComparableHost) {
    let score = 90
    if (looksAuthLikePath(storedPath) || looksAuthLikePath(pagePath)) score += 4
    if (storedPath === '/' || pagePath === '/' || pagePath.startsWith(storedPath) || storedPath.startsWith(pagePath)) score += 2
    return Math.min(score, 95)
  }

  const storedDomain = getRegistrableDomain(storedComparableHost)
  const pageDomain = getRegistrableDomain(pageComparableHost)
  if (!storedDomain || !pageDomain || storedDomain !== pageDomain) return 0

  let score = 74
  if (hasAuthLikeSubdomain(storedHost) || hasAuthLikeSubdomain(pageHost)) score += 8
  if (looksAuthLikePath(storedPath) || looksAuthLikePath(pagePath)) score += 8
  if (storedPath === '/' || pagePath === '/' || pagePath.startsWith(storedPath) || storedPath.startsWith(pagePath)) score += 4
  return Math.min(score, 89)
}

export function urlsMatch(storedUrl: string, pageUrl: string): boolean {
  return getUrlMatchScore(storedUrl, pageUrl) >= 74
}
