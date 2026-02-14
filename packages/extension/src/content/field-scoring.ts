export interface FieldScore {
  element: HTMLInputElement
  score: number
  fieldType: 'username' | 'password' | 'email' | 'totp' | 'unknown'
  factors: {
    autocompleteMatch: number
    typeMatch: number
    namePattern: number
    idPattern: number
    placeholderPattern: number
    ariaLabelPattern: number
    siblingContext: number
  }
}

interface FieldPatterns {
  username: RegExp[]
  password: RegExp[]
  email: RegExp[]
  totp: RegExp[]
}

export const USERNAME_PATTERNS: RegExp[] = [
  /user/i, /login/i, /usr/i, /uname/i,
  /account/i, /acct/i, /signin/i, /sign-in/i,
  /session/i, /member/i, /alias/i
]

export const EMAIL_PATTERNS: RegExp[] = [
  /email/i, /e-mail/i, /mail/i
]

export const PASSWORD_PATTERNS: RegExp[] = [
  /pass/i, /password/i, /pwd/i, /secret/i,
  /passphrase/i, /key/i, /credential/i
]

export const TOTP_PATTERNS: RegExp[] = [
  /totp/i, /otp/i, /2fa/i, /mfa/i, /two-factor/i,
  /twofactor/i, /authenticat/i, /verification/i,
  /code/i, /pin/i, /token/i
]

const AUTOCOMPLETE_VALUES: Record<string, string[]> = {
  username: ['username', 'login', 'user'],
  email: ['email', 'username'],
  password: ['current-password', 'password', 'new-password'],
  totp: ['one-time-code', 'totp']
}

function calculateFieldScore(
  input: HTMLInputElement,
  type: keyof FieldPatterns
): number {
  const patterns = getPatternsForType(type)
  let score = 0
  const factors = {
    autocompleteMatch: 0,
    typeMatch: 0,
    namePattern: 0,
    idPattern: 0,
    placeholderPattern: 0,
    ariaLabelPattern: 0,
    siblingContext: 0
  }

  const autocomplete = input.getAttribute('autocomplete') || ''
  const expectedAutocompletes = AUTOCOMPLETE_VALUES[type] || []
  if (expectedAutocompletes.some(v => autocomplete.includes(v))) {
    factors.autocompleteMatch = 10
    score += 10
  }

  if (type === 'password' && input.type === 'password') {
    factors.typeMatch = 8
    score += 8
  }
  if (type === 'email' && input.type === 'email') {
    factors.typeMatch = 8
    score += 8
  }
  if (type === 'totp' && (input.type === 'tel' || input.inputMode === 'numeric')) {
    factors.typeMatch = 6
    score += 6
  }

  const name = input.name || ''
  const id = input.id || ''
  const placeholder = input.placeholder || ''
  const ariaLabel = input.getAttribute('aria-label') || ''
  const ariaLabelledBy = input.getAttribute('aria-labelledby') || ''

  if (matchesPattern(name, patterns)) {
    factors.namePattern = 6
    score += 6
  }

  if (matchesPattern(id, patterns)) {
    factors.idPattern = 6
    score += 6
  }

  if (matchesPattern(placeholder, patterns)) {
    factors.placeholderPattern = 4
    score += 4
  }

  if (matchesPattern(ariaLabel, patterns)) {
    factors.ariaLabelPattern = 4
    score += 4
  }

  if (ariaLabelledBy) {
    const labelText = getLabelText(ariaLabelledBy)
    if (matchesPattern(labelText, patterns)) {
      factors.ariaLabelPattern = 4
      score += 4
    }
  }

  const siblingScore = analyzeSiblingContext(input, patterns)
  if (siblingScore > 0) {
    factors.siblingContext = siblingScore
    score += siblingScore
  }

  return score
}

function getPatternsForType(type: keyof FieldPatterns): RegExp[] {
  switch (type) {
    case 'username': return USERNAME_PATTERNS
    case 'password': return PASSWORD_PATTERNS
    case 'email': return EMAIL_PATTERNS
    case 'totp': return TOTP_PATTERNS
    default: return []
  }
}

function matchesPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(value))
}

function getLabelText(labelledById: string): string {
  const label = document.getElementById(labelledById)
  if (label) {
    return label.textContent || ''
  }
  return ''
}

function analyzeSiblingContext(input: HTMLInputElement, patterns: RegExp[]): number {
  const parent = input.parentElement
  if (!parent) return 0

  const siblings = Array.from(parent.children)
  for (const sibling of siblings) {
    if (sibling === input) continue
    const text = sibling.textContent || ''
    if (matchesPattern(text, patterns)) {
      return 5
    }
  }

  const grandparent = parent.parentElement
  if (grandparent) {
    const parentSiblings = Array.from(grandparent.children)
    for (const sibling of parentSiblings) {
      if (sibling.contains(input)) continue
      const text = sibling.textContent || ''
      if (matchesPattern(text, patterns)) {
        return 5
      }
    }
  }

  return 0
}

export function scoreInputField(input: HTMLInputElement): FieldScore {
  const scores: { type: Exclude<FieldScore['fieldType'], 'unknown'>; score: number; factors: FieldScore['factors'] }[] = []

  const types: Array<Exclude<FieldScore['fieldType'], 'unknown'>> = ['username', 'password', 'email', 'totp']

  for (const type of types) {
    const score = calculateFieldScore(input, type)
    const factors = {
      autocompleteMatch: 0,
      typeMatch: 0,
      namePattern: 0,
      idPattern: 0,
      placeholderPattern: 0,
      ariaLabelPattern: 0,
      siblingContext: 0
    }

    const autocomplete = input.getAttribute('autocomplete') || ''
    const patterns = getPatternsForType(type)
    const name = input.name || ''
    const id = input.id || ''
    const placeholder = input.placeholder || ''
    const ariaLabel = input.getAttribute('aria-label') || ''

    if (AUTOCOMPLETE_VALUES[type]?.some(v => autocomplete.includes(v))) {
      factors.autocompleteMatch = 10
    }
    if (type === 'password' && input.type === 'password') {
      factors.typeMatch = 8
    } else if (type === 'email' && input.type === 'email') {
      factors.typeMatch = 8
    } else if (type === 'totp' && (input.type === 'tel' || input.inputMode === 'numeric')) {
      factors.typeMatch = 6
    }
    if (matchesPattern(name, patterns)) factors.namePattern = 6
    if (matchesPattern(id, patterns)) factors.idPattern = 6
    if (matchesPattern(placeholder, patterns)) factors.placeholderPattern = 4
    if (matchesPattern(ariaLabel, patterns)) factors.ariaLabelPattern = 4
    factors.siblingContext = analyzeSiblingContext(input, patterns)

    scores.push({ type, score, factors })
  }

  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]

  return {
    element: input,
    score: best.score,
    fieldType: best.score > 5 ? best.type : 'unknown',
    factors: best.factors
  }
}

export interface FormFields {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
  email: HTMLInputElement | null
  totp: HTMLInputElement | null
}

export function identifyLoginFields(form: HTMLFormElement | null): FormFields {
  let inputs: HTMLInputElement[]

  if (form) {
    inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'))
  } else {
    inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'))
  }

  const scoredFields = inputs.map(scoreInputField)
  scoredFields.sort((a, b) => b.score - a.score)

  const result: FormFields = {
    username: null,
    password: null,
    email: null,
    totp: null
  }

  const usedElements = new Set<HTMLInputElement>()

  for (const field of scoredFields) {
    if (usedElements.has(field.element)) continue
    if (field.score < 3) continue

    switch (field.fieldType) {
      case 'username':
        if (!result.username) {
          result.username = field.element
          usedElements.add(field.element)
        }
        break
      case 'password':
        if (!result.password) {
          result.password = field.element
          usedElements.add(field.element)
        }
        break
      case 'email':
        if (!result.email && !result.username) {
          result.email = field.element
          usedElements.add(field.element)
        }
        break
      case 'totp':
        if (!result.totp) {
          result.totp = field.element
          usedElements.add(field.element)
        }
        break
    }
  }

  return result
}

export function isLoginForm(form: HTMLFormElement): boolean {
  const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="submit"])'))

  let hasPassword = false
  let hasUsername = false

  for (const input of inputs) {
    if (!(input instanceof HTMLInputElement)) continue
    const type = input.type.toLowerCase()
    const name = (input.name || '').toLowerCase()
    const id = (input.id || '').toLowerCase()

    if (type === 'password') {
      hasPassword = true
    }

    if (type === 'text' || type === 'email') {
      if (USERNAME_PATTERNS.some(p => p.test(name) || p.test(id))) {
        hasUsername = true
      }
    }
  }

  return hasPassword || (hasUsername && inputs.length <= 3)
}
