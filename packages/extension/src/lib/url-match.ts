const AUTH_PATH_SEGMENTS = new Set([
  'login',
  'signin',
  'sign-in',
  'auth',
  'account',
  'session'
])

const COMMON_SECOND_LEVEL_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'com.br',
  'com.mx',
  'com.tr',
  'com.ar'
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

function looksAuthLikePath(pathname: string): boolean {
  return pathname
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .some(segment => AUTH_PATH_SEGMENTS.has(segment))
}

export function urlsMatch(storedUrl: string, pageUrl: string): boolean {
  const stored = parseUrlCandidate(storedUrl)
  const page = parseUrlCandidate(pageUrl)
  if (!stored || !page) return false

  const storedHost = stored.hostname.toLowerCase()
  const pageHost = page.hostname.toLowerCase()

  if (storedHost === pageHost) return true

  const storedDomain = getRegistrableDomain(storedHost)
  const pageDomain = getRegistrableDomain(pageHost)
  if (!storedDomain || !pageDomain || storedDomain !== pageDomain) return false

  const storedPath = stored.pathname || '/'
  const pagePath = page.pathname || '/'
  if (storedPath === '/' || pagePath === '/') return true
  if (pagePath.startsWith(storedPath) || storedPath.startsWith(pagePath)) return true
  if (looksAuthLikePath(storedPath) || looksAuthLikePath(pagePath)) return true

  // Same registrable domain fallback for related pages.
  return true
}
